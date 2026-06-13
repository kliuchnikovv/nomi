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
import uuid
from typing import Any

from src.server.models import Op
from src.server.utils import make_signal

logger = logging.getLogger(__name__)

# Hard cap so a misparsed plan can't spawn an unbounded loop.
MAX_STEPS = 10


class TaskEventEmitter:
    """Publishes task lifecycle messages for persistence (Go) + live UI."""

    def __init__(self, redis: Any, task_id: str, user_id: str, chat_id: str, goal: str):
        self.redis = redis
        self.task_id = task_id
        self.user_id = user_id
        self.chat_id = chat_id
        self.goal = goal
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
    ) -> None:
        """Publish one task update. ``kind`` adds an appended log event."""
        msg: dict[str, Any] = {
            "user_id": self.user_id,
            "chat_id": self.chat_id,
            "goal": self.goal,
            "status": status,
            "finished": finished,
        }
        if plan is not None:
            msg["plan"] = plan
        if result is not None:
            msg["result"] = result
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


async def _agent_text(agent: Any, prompt: str) -> str:
    """Run the agent once (non-streaming) and return its text content."""
    result = await agent.arun(prompt)
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
    ):
        self.emitter = TaskEventEmitter(redis, task_id, user_id, chat_id, goal)
        self.task_id = task_id
        self.goal = goal
        self.agent = agent
        self.max_steps = max_steps

    async def run(self) -> None:
        try:
            await self.emitter.emit("planning")

            # 1. Plan: decompose the goal into concrete steps.
            plan_prompt = (
                "Break the following goal into 3-7 concrete, ordered steps. "
                "Return ONLY a JSON array of short step titles, nothing else.\n\n"
                f"Goal: {self.goal}"
            )
            plan_text = await _agent_text(self.agent, plan_prompt)
            titles = _parse_steps(plan_text, self.goal)[: self.max_steps]
            plan = [
                {"id": i, "title": t, "status": "pending", "result": ""}
                for i, t in enumerate(titles)
            ]
            await self.emitter.emit(
                "running", plan=plan, kind="plan_update", payload={"plan": plan}
            )

            # 2. Execute each step in order.
            accumulated: list[str] = []
            for step in plan:
                step["status"] = "running"
                await self.emitter.emit(
                    "running",
                    plan=plan,
                    kind="step_started",
                    payload={"step_id": step["id"], "title": step["title"]},
                )

                context = "\n".join(accumulated[-3:]) if accumulated else "(none)"
                step_prompt = (
                    f"You are autonomously executing a multi-step task.\n"
                    f"Overall goal: {self.goal}\n"
                    f"Current step {step['id'] + 1}/{len(plan)}: {step['title']}\n"
                    f"Results of previous steps:\n{context}\n\n"
                    "Carry out this step now and report what you did concisely."
                )
                summary = await _agent_text(self.agent, step_prompt)

                step["status"] = "done"
                step["result"] = summary
                accumulated.append(f"Step {step['id'] + 1}: {summary}")
                await self.emitter.emit(
                    "running",
                    plan=plan,
                    kind="step_done",
                    payload={"step_id": step["id"], "result": summary},
                )

            # 3. Done.
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

        except asyncio.CancelledError:
            logger.warning("[TaskRunner] task %s cancelled", self.task_id)
            await self.emitter.emit(
                "cancelled", finished=True, kind="error", payload={"reason": "cancelled"}
            )
            raise
        except Exception as exc:  # noqa: BLE001
            logger.error("[TaskRunner] task %s failed: %s", self.task_id, exc, exc_info=True)
            await self.emitter.emit(
                "failed",
                result=str(exc),
                finished=True,
                kind="error",
                payload={"error": str(exc)},
            )


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

    if not goal:
        logger.warning("[TaskRunner] task_start with empty goal, ignoring")
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
    await session.build_agent_instance(payload)

    runner = TaskRunner(
        redis=redis,
        task_id=task_id,
        user_id=user_id,
        chat_id=chat_id,
        goal=goal,
        agent=session.agent,
    )
    await runner.run()
