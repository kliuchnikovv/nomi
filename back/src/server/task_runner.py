"""Long-running autonomous agent tasks.

A ``TaskRunner`` drives a plan -> execute loop independent of the chat
request/response cycle. It decomposes a goal into steps, executes each step with
an already-built agent (Nomi, which can delegate to the sandbox engineer), and
emits progress.

Persistence follows the "Go is the single writer" model: the runner publishes
task lifecycle messages to ``agent:task:event:{task_id}`` and the Go API's
AgentTaskListener upserts the agent_tasks / agent_task_events rows. The runner
also publishes a best-effort live signal frame to ``chat:user:{user_id}`` so the
mobile client can stream progress.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from typing import Any

from src.server import stub_brain
from src.server.models import Op
from src.server.utils import make_signal

logger = logging.getLogger(__name__)

# Hard cap so a misparsed plan can't spawn an unbounded loop.
MAX_STEPS = 10

# How long a step may wait for user approval before it is treated as rejected.
APPROVAL_TIMEOUT_S = 600
_APPROVAL_POLL_S = 1.0

# How long a coding task waits for a clarification answer before giving up
# (rejection is fail-safe: better to stop than to code on a wrong assumption).
CLARIFY_TIMEOUT_S = int(os.getenv("CLARIFY_TIMEOUT_S", "1800"))
_CLARIFY_POLL_S = 1.0

# Per-step retry: a transient step failure is retried a few times (linear
# backoff) before the whole task is marked failed. Both env-overridable.
STEP_MAX_ATTEMPTS = int(os.getenv("TASK_STEP_MAX_ATTEMPTS", "3"))
STEP_RETRY_BACKOFF_S = float(os.getenv("TASK_STEP_RETRY_BACKOFF_S", "5"))

# Steps whose title matches any of these need explicit user approval before they
# run (coarse, title-level risk heuristic — the runner can't see individual
# shell commands the sandbox engineer issues).
_RISKY_KEYWORDS = (
    "push",
    "pull request",
    "open a pr",
    "open pr",
    "deploy",
    "publish",
    "release",
    "delete",
    "force",
    "merge",
    "drop ",
)


def _needs_approval(title: str) -> bool:
    t = (title or "").lower()
    return any(k in t for k in _RISKY_KEYWORDS)


class TaskEventEmitter:
    """Publishes task lifecycle messages for persistence (Go) + live UI."""

    def __init__(
        self,
        redis: Any,
        task_id: str,
        user_id: str,
        chat_id: str,
        goal: str,
        *,
        live: bool = True,
        background: bool = True,
        agent: str = "",
    ):
        self.redis = redis
        self.task_id = task_id
        self.user_id = user_id
        self.chat_id = chat_id
        self.goal = goal
        # background=True → autonomous task that shows on the Tasks screen.
        # background=False → a synchronous delegation persisted for audit/chat
        # linkage but filtered out of the task list (live=False keeps it from
        # flashing in the live UI too). ``agent`` records which sub-agent ran.
        self.live = live
        self.background = background
        self.agent = agent
        self._seq = 0
        self._frame_id = 0

    async def emit(
        self,
        status: str,
        *,
        plan: list[dict] | None = None,
        result: str | None = None,
        finished: bool = False,
        kind: str | None = None,
        payload: dict | None = None,
        current_step: int | None = None,
        attempt: int | None = None,
        pending_approval: dict | None = None,
    ) -> None:
        """Publish one task update. ``kind`` adds an appended log event.

        ``current_step``/``attempt`` persist the durable resume cursor so a
        crashed task can be relaunched from the right step. ``pending_approval``
        records the in-flight approval identity while ``status`` is
        ``waiting_input``; the Go listener clears it automatically once the
        status moves on.
        """
        msg: dict[str, Any] = {
            "user_id": self.user_id,
            "chat_id": self.chat_id,
            "goal": self.goal,
            "status": status,
            "finished": finished,
            "background": self.background,
            "agent": self.agent,
        }
        if plan is not None:
            msg["plan"] = plan
        if result is not None:
            msg["result"] = result
        if current_step is not None:
            msg["current_step"] = current_step
        if attempt is not None:
            msg["attempt"] = attempt
        if pending_approval is not None:
            msg["pending_approval"] = pending_approval
        if kind is not None:
            self._seq += 1
            msg["event"] = {"seq": self._seq, "kind": kind, "payload": payload or {}}

        if self.redis is None:
            return

        # 1. Persistence channel — consumed by the Go AgentTaskListener.
        try:
            await self.redis.publish(
                f"agent:task:event:{self.task_id}", json.dumps(msg)
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[TaskRunner] persist publish failed: %s", exc)

        # 2. Live UI frame — best-effort; the mobile Tasks view streams these.
        # Synchronous delegations (live=False) skip this: they're meant to be
        # invisible, surfacing only as the in-chat tool bubble.
        if not self.live:
            return
        try:
            ui_payload = {"type": "task_progress", "task_id": self.task_id, **msg}
            frame = make_signal(self._frame_id, Op.SIGNAL, self.chat_id, ui_payload)
            self._frame_id += 1
            await self.redis.publish(
                f"chat:user:{self.user_id}", json.dumps(frame.marshal())
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("[TaskRunner] live UI publish failed: %s", exc)


def _parse_steps(text: str, goal: str) -> list[str]:
    """Extract a list of step titles from the planner's response.

    Expects a JSON array of strings; falls back to a single step (the goal) if
    the response can't be parsed.
    """
    if text:
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end != -1 and end > start:
            try:
                parsed = json.loads(text[start : end + 1])
                steps = [str(s).strip() for s in parsed if str(s).strip()]
                if steps:
                    return steps[:MAX_STEPS]
            except (json.JSONDecodeError, TypeError):
                pass
    return [goal]


def _parse_coding_plan(text: str, goal: str) -> tuple[list[dict], list[str]]:
    """Parse the code planner's ``{questions, plan}`` JSON response.

    Returns ``(questions, titles)`` where ``questions`` is a list of
    ``{"q": str, "opts": [str]}`` and ``titles`` is the ordered step list.
    Falls back to no questions + a single step (the goal) if unparseable.
    """
    questions: list[dict] = []
    titles: list[str] = []
    if text:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                obj = json.loads(text[start : end + 1])
            except (json.JSONDecodeError, TypeError):
                obj = None
            if isinstance(obj, dict):
                for q in obj.get("questions") or []:
                    if isinstance(q, dict) and str(q.get("q", "")).strip():
                        opts = [
                            str(o).strip()
                            for o in (q.get("opts") or [])
                            if str(o).strip()
                        ]
                        questions.append({"q": str(q["q"]).strip(), "opts": opts})
                    elif isinstance(q, str) and q.strip():
                        questions.append({"q": q.strip(), "opts": []})
                for s in obj.get("plan") or []:
                    if str(s).strip():
                        titles.append(str(s).strip())
    if not titles:
        titles = [goal]
    return questions[:MAX_STEPS], titles[:MAX_STEPS]


async def _agent_text(agent: Any, prompt: str) -> str:
    """Run the agent once (non-streaming) and return its text content.

    Passes stream=False so NomiAgent.arun awaits the result directly and
    returns a RunResponse instead of an async generator.
    """
    result = await agent.arun(prompt, stream=False)
    # Fallback: consume if we somehow still got a generator.
    if hasattr(result, "__aiter__"):
        last_content = ""
        async for chunk in result:
            text = getattr(chunk, "content", None)
            if isinstance(text, str) and text:
                last_content = text
        return last_content
    content = getattr(result, "content", None)
    return content if isinstance(content, str) else str(result)


class TaskRunner:
    """Owns the plan -> execute loop for one background task.

    The agent is injected (already built), which keeps the loop testable.
    """

    def __init__(
        self,
        *,
        redis: Any,
        task_id: str,
        user_id: str,
        chat_id: str,
        goal: str,
        agent: Any,
        max_steps: int = MAX_STEPS,
        task_kind: str = "generic",
        repo: dict | None = None,
        resume_state: dict | None = None,
        code_planner: Any = None,
    ):
        self.emitter = TaskEventEmitter(redis, task_id, user_id, chat_id, goal)
        self.redis = redis
        self.task_id = task_id
        self.goal = goal
        self.agent = agent
        self.max_steps = max_steps
        # "coding" tasks get a plan -> clarify -> approval phase before execution
        # and survey-first, full-repo step prompts. "generic" keeps the old flow.
        self.task_kind = task_kind
        self.repo = repo or None
        # Non-empty when relaunched by the reconciler after a crash/restart.
        self.resume_state = resume_state or None
        # Optional dedicated planner agent; falls back to the main agent.
        self.code_planner = code_planner
        # Q/A gathered in the clarify phase, injected into every step prompt.
        self.clarifications: list[str] = []
        # Seed the event seq so re-emitted events on resume stay monotonic and
        # don't collide with historical rows (Go dedupes on (task_id, seq)).
        if self.resume_state:
            try:
                self.emitter._seq = int(self.resume_state.get("last_seq") or 0)
            except (TypeError, ValueError):
                self.emitter._seq = 0

    async def _drain_steering(self) -> list[str]:
        """Pop any pending user steering messages (non-blocking)."""
        msgs: list[str] = []
        if self.redis is None:
            return msgs
        key = f"agent:task:steer:{self.task_id}"
        try:
            while True:
                item = await self.redis.lpop(key)
                if item is None:
                    break
                if isinstance(item, bytes):
                    item = item.decode("utf-8", errors="replace")
                try:
                    obj = json.loads(item)
                    msgs.append(
                        obj.get("message", item)
                        if isinstance(obj, dict)
                        else str(obj)
                    )
                except json.JSONDecodeError:
                    msgs.append(item)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[TaskRunner] steering drain failed: %s", exc)
        return msgs

    async def _await_approval(self, request_id: str) -> bool:
        """Block (cancellably) until the user approves/rejects, or timeout.

        Timeout is treated as rejection (fail safe). A decision without a
        request_id, or one matching ours, resolves the wait.
        """
        if self.redis is None:
            return False
        key = f"agent:task:approval:{self.task_id}"
        waited = 0.0
        while waited < APPROVAL_TIMEOUT_S:
            try:
                item = await self.redis.lpop(key)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[TaskRunner] approval poll failed: %s", exc)
                item = None
            if item is not None:
                if isinstance(item, bytes):
                    item = item.decode("utf-8", errors="replace")
                try:
                    obj = json.loads(item)
                except json.JSONDecodeError:
                    obj = {}
                if not obj.get("request_id") or obj.get("request_id") == request_id:
                    return bool(obj.get("approved"))
                # A decision for a different request — ignore and keep waiting.
            await asyncio.sleep(_APPROVAL_POLL_S)
            waited += _APPROVAL_POLL_S
        logger.warning(
            "[TaskRunner] approval %s timed out → treating as rejected", request_id
        )
        return False

    async def _await_clarify(self, request_id: str) -> str:
        """Block (cancellably) until the user answers a clarify_request, or timeout.

        Returns the answer text, or "" on timeout (caller treats "" as no answer).
        A detached task can't use the live ask_user round-trip (that channel is
        bound to a chat WS turn), so we poll the same redis-list pattern as
        approvals: the Go /tasks/:id/clarify handler RPUSHes the answer here.
        """
        if self.redis is None:
            return ""
        key = f"agent:task:clarify:{self.task_id}"
        waited = 0.0
        while waited < CLARIFY_TIMEOUT_S:
            try:
                item = await self.redis.lpop(key)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[TaskRunner] clarify poll failed: %s", exc)
                item = None
            if item is not None:
                if isinstance(item, bytes):
                    item = item.decode("utf-8", errors="replace")
                try:
                    obj = json.loads(item)
                except json.JSONDecodeError:
                    obj = {}
                if not obj.get("request_id") or obj.get("request_id") == request_id:
                    return str(obj.get("answer") or "")
                # An answer for a different request — ignore and keep waiting.
            await asyncio.sleep(_CLARIFY_POLL_S)
            waited += _CLARIFY_POLL_S
        logger.warning("[TaskRunner] clarify %s timed out → no answer", request_id)
        return ""

    async def _run_stub(self) -> None:
        """Drive a fixed, deterministic lifecycle for e2e regression tests.

        Mirrors the real plan -> execute -> done emit sequence (so persisted
        events/status are identical in shape) but skips every agent call.
        """
        await self.emitter.emit("planning")
        plan = [
            {"id": i, "title": t, "status": "pending", "result": ""}
            for i, t in enumerate(stub_brain.stub_task_steps())
        ]
        await self.emitter.emit(
            "running", plan=plan, kind="plan_update", payload={"plan": plan}
        )
        for step in plan:
            step["status"] = "running"
            await self.emitter.emit(
                "running",
                plan=plan,
                kind="step_started",
                payload={"step_id": step["id"], "title": step["title"]},
            )
            step["status"] = "done"
            step["result"] = f"{step['title']} ok"
            await self.emitter.emit(
                "running",
                plan=plan,
                kind="step_done",
                payload={"step_id": step["id"], "result": step["result"]},
            )
        await self.emitter.emit(
            "done",
            plan=plan,
            result="stub task complete",
            finished=True,
            kind="done",
            payload={"result": "stub task complete"},
        )
        logger.info("[TaskRunner] stub task %s completed", self.task_id)

    async def run(self) -> None:
        if stub_brain.is_enabled() and self.goal.strip() == stub_brain.TASK:
            await self._run_stub()
            return
        try:
            if self.resume_state:
                await self._run_resume()
            elif self.task_kind == "coding":
                await self._run_coding()
            else:
                await self._run_generic()
        except asyncio.CancelledError:
            logger.warning("[TaskRunner] task %s cancelled", self.task_id)
            await self.emitter.emit(
                "cancelled", finished=True, kind="error", payload={"reason": "cancelled"}
            )
            raise
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "[TaskRunner] task %s failed: %s", self.task_id, exc, exc_info=True
            )
            await self.emitter.emit(
                "failed",
                result=str(exc),
                finished=True,
                kind="error",
                payload={"error": str(exc)},
            )

    async def _emit_done(self, plan: list[dict], accumulated: list[str]) -> None:
        final = accumulated[-1] if accumulated else "Task completed."
        await self.emitter.emit(
            "done",
            plan=plan,
            result=final,
            finished=True,
            kind="done",
            payload={"result": final},
        )
        logger.info("[TaskRunner] task %s completed", self.task_id)

    def _repo_hint(self) -> str:
        """One-line target-repo hint for prompts (empty when no repo is set)."""
        if not self.repo:
            return ""
        owner = str(self.repo.get("owner") or "")
        name = str(self.repo.get("repo") or "")
        ref = str(self.repo.get("ref") or "")
        full = f"{owner}/{name}".strip("/")
        if not full:
            return ""
        line = f"Target repository: {full}"
        if ref:
            line += f" (ref {ref})"
        return line + "\n"

    @staticmethod
    def _parse_repo_answer(answer: str) -> dict:
        """Best-effort parse of a user-typed repo (URL or owner/repo)."""
        s = (answer or "").strip()
        s = (
            s.replace("https://github.com/", "")
            .replace("http://github.com/", "")
            .strip("/")
        )
        if "/" in s:
            owner, _, rest = s.partition("/")
            name = rest.split("/")[0] if rest else ""
            return {"owner": owner, "repo": name, "ref": None}
        return {"owner": "", "repo": s, "ref": None}

    def _coding_plan_prompt(self) -> str:
        return (
            "You are planning a software change BEFORE any code is written.\n"
            f"Goal: {self.goal}\n"
            f"{self._repo_hint()}"
            'First, use delegate_to("sandbox_engineer", ...) to clone the ENTIRE '
            "target repository into /workspace and survey it: list the top-level "
            "layout and grep/find across ALL layers (backend, API, frontend/mobile, "
            "infra/config, migrations, tests) in whatever languages are present, to "
            "locate every place the change must be wired. Then return ONLY a JSON "
            'object of the form {"questions": [{"q": "...", "opts": ["..."]}], '
            '"plan": ["step title", ...]}. Put in "questions" only genuine '
            "implementation decisions that need the user (scope, choices, "
            'ambiguities) — leave empty if none. Make "plan" a list of 3-7 concrete '
            "ordered step titles that name the specific files/layers to touch so no "
            "layer is left unwired. Return the JSON and nothing else."
        )

    def _build_step_prompt(
        self,
        step: dict,
        plan: list[dict],
        accumulated: list[str],
        guidance: list[str],
    ) -> str:
        context = "\n".join(accumulated[-3:]) if accumulated else "(none)"
        guidance_text = (
            "\nUser guidance to follow:\n" + "\n".join(guidance) if guidance else ""
        )
        if self.task_kind == "coding":
            clar = (
                "\nAnswers to clarifying questions:\n" + "\n".join(self.clarifications)
                if self.clarifications
                else ""
            )
            return (
                "You are autonomously implementing a coding task across a full "
                "repository.\n"
                f"Overall goal: {self.goal}\n"
                f"{self._repo_hint()}"
                f"Current step {step['id'] + 1}/{len(plan)}: {step['title']}\n"
                f"Results of previous steps:\n{context}\n"
                f"{guidance_text}{clar}\n"
                "Delegate all code/file/command work to "
                'delegate_to("sandbox_engineer", ...) (or delegate_to("developer", '
                "...) if available). The sandbox already has the repository cloned "
                "into /workspace. Before changing anything, make sure the change is "
                "wired through EVERY affected layer (backend, API, frontend/mobile, "
                "config, migrations, tests) — never ship an isolated module that "
                "leaves other layers unwired. Carry out this step now and report what "
                "you did concisely."
            )
        return (
            "You are autonomously executing a multi-step task.\n"
            f"Overall goal: {self.goal}\n"
            f"Current step {step['id'] + 1}/{len(plan)}: {step['title']}\n"
            f"Results of previous steps:\n{context}\n"
            f"{guidance_text}\n"
            "You have full filesystem and shell access: for ANY code, file, or "
            'command-line work, call delegate_to("sandbox_engineer", ...) — it runs '
            "in an isolated Linux sandbox where you can clone repos, read/write files, "
            "run commands, and analyze codebases. Never claim you lack the ability to "
            "access files, run code, or analyze a codebase; if a tool errors, report "
            "the concrete error and what you tried. Carry out this step now and report "
            "what you did concisely."
        )

    async def _execute_plan(
        self,
        plan: list[dict],
        accumulated: list[str],
        guidance: list[str],
        *,
        start_idx: int = 0,
        resume_attempt: int = 0,
        resume_pending: dict | None = None,
    ) -> list[str]:
        """Run steps ``plan[start_idx:]`` with steering, approval, and retry.

        Emits the durable ``current_step``/``attempt`` cursor on every step
        transition so a crash resumes at the right place.
        """
        first = True
        for step in plan[start_idx:]:
            # Absorb any user steering issued since the last step.
            for msg in await self._drain_steering():
                guidance.append(msg)
                await self.emitter.emit(
                    "running",
                    plan=plan,
                    kind="log",
                    payload={"message": f"User guidance: {msg}"},
                )

            # Approval gate for risky steps (push/PR/deploy/delete/...).
            if _needs_approval(step["title"]):
                if (
                    first
                    and resume_pending
                    and resume_pending.get("step_id") == step["id"]
                    and resume_pending.get("request_id")
                ):
                    # Resume: reuse the pre-crash request_id so an answer the user
                    # already submitted (still in the redis list) resolves at once.
                    request_id = str(resume_pending["request_id"])
                else:
                    request_id = str(uuid.uuid4())
                await self.emitter.emit(
                    "waiting_input",
                    plan=plan,
                    kind="approval_request",
                    payload={
                        "request_id": request_id,
                        "step_id": step["id"],
                        "title": step["title"],
                    },
                    current_step=step["id"],
                    pending_approval={
                        "request_id": request_id,
                        "step_id": step["id"],
                    },
                )
                approved = await self._await_approval(request_id)
                if not approved:
                    step["status"] = "done"
                    step["result"] = "Skipped — not approved."
                    await self.emitter.emit(
                        "running",
                        plan=plan,
                        kind="step_done",
                        payload={
                            "step_id": step["id"],
                            "result": "skipped (not approved)",
                        },
                        current_step=step["id"] + 1,
                        attempt=0,
                    )
                    first = False
                    continue
                await self.emitter.emit(
                    "running",
                    plan=plan,
                    kind="log",
                    payload={"message": f"Approved: {step['title']}"},
                )

            # Execute the step (with per-step retry).
            step["status"] = "running"
            await self.emitter.emit(
                "running",
                plan=plan,
                kind="step_started",
                payload={"step_id": step["id"], "title": step["title"]},
                current_step=step["id"],
            )

            step_prompt = self._build_step_prompt(step, plan, accumulated, guidance)
            attempt = resume_attempt if first else 0
            while True:
                try:
                    summary = await _agent_text(self.agent, step_prompt)
                    break
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    attempt += 1
                    await self.emitter.emit(
                        "running",
                        plan=plan,
                        kind="log",
                        payload={
                            "message": (
                                f"Step failed (attempt {attempt}/"
                                f"{STEP_MAX_ATTEMPTS}): {exc}"
                            )
                        },
                        current_step=step["id"],
                        attempt=attempt,
                    )
                    if attempt >= STEP_MAX_ATTEMPTS:
                        step["status"] = "failed"
                        raise
                    await asyncio.sleep(STEP_RETRY_BACKOFF_S * attempt)

            step["status"] = "done"
            step["result"] = summary
            accumulated.append(f"Step {step['id'] + 1}: {summary}")
            await self.emitter.emit(
                "running",
                plan=plan,
                kind="step_done",
                payload={"step_id": step["id"], "result": summary},
                current_step=step["id"] + 1,
                attempt=0,
            )
            first = False
        return accumulated

    async def _run_generic(self) -> None:
        await self.emitter.emit("planning")
        plan_prompt = (
            "Break the following goal into 3-7 concrete, ordered steps. "
            "You have full filesystem and shell access via an isolated Linux "
            "sandbox (clone repos, read/write files, run commands, analyze "
            "code), so plan real execution steps — do not assume any capability "
            "is missing. Return ONLY a JSON array of short step titles, nothing "
            "else.\n\n"
            f"Goal: {self.goal}"
        )
        plan_text = await _agent_text(self.agent, plan_prompt)
        titles = _parse_steps(plan_text, self.goal)[: self.max_steps]
        plan = [
            {"id": i, "title": t, "status": "pending", "result": ""}
            for i, t in enumerate(titles)
        ]
        await self.emitter.emit(
            "running",
            plan=plan,
            kind="plan_update",
            payload={"plan": plan},
            current_step=0,
        )
        accumulated = await self._execute_plan(plan, [], [])
        await self._emit_done(plan, accumulated)

    async def _run_coding(self) -> None:
        await self.emitter.emit("planning")

        # Need a target repo. If none was supplied, ask for one up front.
        if not self.repo:
            rid = str(uuid.uuid4())
            await self.emitter.emit(
                "waiting_input",
                plan=[],
                kind="clarify_request",
                payload={
                    "request_id": rid,
                    "question": (
                        "Which GitHub repository should I work in? (owner/repo)"
                    ),
                    "options": [],
                },
            )
            answer = await self._await_clarify(rid)
            if not answer:
                await self.emitter.emit(
                    "cancelled",
                    finished=True,
                    kind="error",
                    payload={"reason": "no repository specified"},
                )
                return
            self.repo = self._parse_repo_answer(answer)

        # Survey the whole repo and propose questions + a plan.
        planner = self.code_planner or self.agent
        plan_text = await _agent_text(planner, self._coding_plan_prompt())
        questions, titles = _parse_coding_plan(plan_text, self.goal)

        # Clarify loop — each question blocks on the redis clarify list.
        for q in questions:
            rid = str(uuid.uuid4())
            await self.emitter.emit(
                "waiting_input",
                plan=[],
                kind="clarify_request",
                payload={
                    "request_id": rid,
                    "question": q["q"],
                    "options": q.get("opts", []),
                },
            )
            answer = await self._await_clarify(rid)
            if not answer:
                await self.emitter.emit(
                    "cancelled",
                    finished=True,
                    kind="error",
                    payload={"reason": "clarification timed out"},
                )
                return
            self.clarifications.append(f"Q: {q['q']}\nA: {answer}")

        plan = [
            {"id": i, "title": t, "status": "pending", "result": ""}
            for i, t in enumerate(titles[: self.max_steps])
        ]
        await self.emitter.emit(
            "running",
            plan=plan,
            kind="plan_update",
            payload={"plan": plan},
            current_step=0,
        )

        # Plan-level approval gate: the user must approve before we write code.
        rid = str(uuid.uuid4())
        await self.emitter.emit(
            "waiting_input",
            plan=plan,
            kind="approval_request",
            payload={
                "request_id": rid,
                "step_id": -1,
                "title": "Approve implementation plan",
            },
            pending_approval={"request_id": rid, "step_id": -1},
        )
        if not await self._await_approval(rid):
            await self.emitter.emit(
                "cancelled",
                finished=True,
                kind="error",
                payload={"reason": "plan rejected"},
            )
            return

        accumulated = await self._execute_plan(plan, [], [])
        await self._emit_done(plan, accumulated)

    async def _run_resume(self) -> None:
        """Relaunch a crashed task from its persisted cursor (no re-planning)."""
        state = self.resume_state or {}
        plan = state.get("plan") or []
        # Rehydrate results of already-completed steps.
        accumulated = [
            f"Step {int(s.get('id', 0)) + 1}: {s.get('result', '')}"
            for s in plan
            if s.get("status") == "done" and s.get("result")
        ]
        guidance = list(state.get("guidance") or [])
        try:
            start_idx = int(state.get("current_step") or 0)
        except (TypeError, ValueError):
            start_idx = 0
        try:
            resume_attempt = int(state.get("attempt") or 0)
        except (TypeError, ValueError):
            resume_attempt = 0

        logger.info(
            "[TaskRunner] resuming task %s at step %s (attempt %s)",
            self.task_id,
            start_idx,
            resume_attempt,
        )
        # Repaint the card on the client.
        await self.emitter.emit(
            "running",
            plan=plan,
            kind="plan_update",
            payload={"plan": plan},
            current_step=start_idx,
        )
        pending = state.get("pending_approval")
        resume_pending = pending if isinstance(pending, dict) else None
        accumulated = await self._execute_plan(
            plan,
            accumulated,
            guidance,
            start_idx=start_idx,
            resume_attempt=resume_attempt,
            resume_pending=resume_pending,
        )
        await self._emit_done(plan, accumulated)


async def build_and_run(
    *,
    agent_factory: Any,
    redis: Any,
    go_ws: Any,
    redis_worker: Any,
    payload: dict,
) -> None:
    """Build the executor agent for a task_start frame and run the task.

    Returns when the task finishes; raises CancelledError if stopped. Imports
    RedisSession lazily to avoid an import cycle.
    """
    from src.server.redis_session import RedisSession

    task_id = str(payload.get("task_id") or uuid.uuid4())
    user_id = str(payload.get("user_id") or payload.get("sender") or "")
    chat_id = str(payload.get("chat_id") or payload.get("session_id") or task_id)
    goal = str(payload.get("goal") or payload.get("message") or "").strip()
    task_kind = str(payload.get("task_kind") or "generic")
    repo = payload.get("repo") if isinstance(payload.get("repo"), dict) else None
    # Present only when the reconciler relaunches a crashed task (see
    # RedisWorker.reconcile_unfinished_tasks): rehydrate instead of re-planning.
    resume_state = (
        payload.get("resume_state")
        if isinstance(payload.get("resume_state"), dict)
        else None
    )

    if not goal:
        logger.warning("[TaskRunner] task_start with empty goal, ignoring")
        return

    # Stub mode: skip agent build entirely (mirrors the chat message path in
    # redis_session.py that returns early before build_agent_instance). The
    # stub task runner never touches self.agent, so None is safe here.
    if stub_brain.is_enabled() and goal == stub_brain.TASK:
        runner = TaskRunner(
            redis=redis,
            task_id=task_id,
            user_id=user_id,
            chat_id=chat_id,
            goal=goal,
            agent=None,
            task_kind=task_kind,
            repo=repo,
            resume_state=resume_state,
        )
        await runner.run()
        return

    session = RedisSession(
        agent_factory=agent_factory,
        session_id=chat_id,
        user_id=user_id,
        chat_id=chat_id,
        redis_worker=redis_worker,
        go_ws=go_ws,
    )
    # Force the full assistant agent so the runner can delegate to the sandbox.
    payload = {**payload, "agent_type": payload.get("agent_type") or "nomi"}
    # Task-run mode: no recursive background tasks + relaxed sandbox limits.
    session._in_task_run = True
    await session.build_agent_instance(payload)

    runner = TaskRunner(
        redis=redis,
        task_id=task_id,
        user_id=user_id,
        chat_id=chat_id,
        goal=goal,
        agent=session.agent,
        task_kind=task_kind,
        repo=repo,
        resume_state=resume_state,
    )
    await runner.run()
