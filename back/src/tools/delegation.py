from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, Awaitable, Callable

from agno.agent import Agent
from agno.tools import Toolkit

logger = logging.getLogger(__name__)

# Overall wall-clock cap for a single delegation, so a runaway sub-agent can't
# loop forever in the sandbox. Per-command timeouts in exec_command apply too.
DELEGATION_TIMEOUT = 300

AgentBuilder = Callable[[], Agent]

# Launches an autonomous background task from a goal, returning its task id.
# Backed by RedisSession._spawn_background_task.
TaskSpawner = Callable[[str], Awaitable[str]]

# Builds a per-delegation lifecycle emitter (task_id, goal, agent) used to
# persist a synchronous delegation as a hidden AgentTask row.
EmitterFactory = Callable[[str, str, str], Any]

# Common names users (and the LLM) reach for, mapped to the real registry key.
# Applied case-insensitively before the registry lookup so delegate_to("devops", ...)
# resolves to the sandbox engineer instead of failing as "Unknown agent".
AGENT_ALIASES = {
    "devops": "sandbox_engineer",
    "dev_ops": "sandbox_engineer",
    "engineer": "sandbox_engineer",
    "sandbox": "sandbox_engineer",
    "coder": "sandbox_engineer",
    # The opencode-driven Developer (BYOK). Only registered when the user has an
    # LLM key configured; otherwise delegate_to falls back to sandbox_engineer.
    "developer": "developer",
    "opencode": "developer",
    "opencoder": "developer",
}

# When an alias resolves to a target that isn't registered (e.g. "developer"
# without a BYOK key), fall back to this registered target if present.
AGENT_FALLBACKS = {
    "developer": "sandbox_engineer",
}


class DelegationTools(Toolkit):
    """Generic delegation tool.

    Exposes ``delegate_to(agent_name, task, background=False)`` so a lead agent
    (Nomi) can hand a task to a registered specialist sub-agent/team. A delegation
    IS a task (an ``AgentTask``):

    * ``background=False`` (default) — runs synchronously: the sub-agent owns its
      own multi-step loop, blocks the turn, and only its final summary flows back.
      A hidden ``AgentTask`` row is persisted for audit/chat linkage (filtered out
      of the Tasks screen).
    * ``background=True`` — hands the goal to an autonomous task runner that
      survives the turn and streams progress to the Tasks screen; returns
      immediately with a task id.

    The registry is a fixed allowlist of buildable targets, keyed by name. Targets
    are built lazily (only when actually delegated to).
    """

    def __init__(
        self,
        registry: dict[str, AgentBuilder],
        timeout: float | None = DELEGATION_TIMEOUT,
        *,
        spawner: TaskSpawner | None = None,
        emitter_factory: EmitterFactory | None = None,
    ):
        super().__init__(name="delegation")
        self._registry = registry
        # Wall-clock cap per synchronous delegation. None disables it (task mode,
        # where the task runner + STOP own cancellation and runs are meant to be long).
        self._timeout = timeout
        # Launches an autonomous background task (background=True). None disables
        # background mode (planner/team, or inside a task run).
        self._spawner = spawner
        # Persists a synchronous delegation as a hidden AgentTask row. None when
        # persistence is unavailable (no redis) or undesired (inside a task run,
        # where the parent task already owns the row).
        self._emitter_factory = emitter_factory
        # Surface available targets in the tool description so the model knows who
        # it can delegate to.
        targets = ", ".join(sorted(registry)) or "(none)"
        bg_hint = (
            " For substantial, multi-step work that needs the sandbox for more than a "
            "couple of steps — e.g. 'clone my repo, fix the failing tests, and open a PR', "
            "'analyze this whole codebase and write a report', 'go through every file in "
            "src/ and summarize it' — set background=True: it returns immediately with a "
            "task id and runs autonomously while the user watches progress and steers it on "
            "the Tasks screen. Leave background=False (the default) for a self-contained "
            "delegation whose summary you need within this turn."
            if spawner is not None
            else ""
        )
        self.add_instructions = True
        self.instructions = (
            "You have access to delegate_to(agent_name, task, background=False). Use it to hand "
            "a self-contained task to a specialist sub-agent that owns the work and returns a "
            f"concise summary. Available agents: {targets}. "
            "Pass everything the sub-agent needs in `task` — it does not see the chat history. "
            "Use 'sandbox_engineer' for anything that needs running, building, installing, or "
            "testing code in an isolated Linux sandbox — including setting up a development "
            "environment, installing dependencies, and writing or running tests (e2e, unit, etc.). "
            "If the user asks to delegate work to a 'devops' or 'engineer' agent, that is "
            "sandbox_engineer. "
            "Use 'developer' (also 'opencode') for autonomous feature implementation: it drives "
            "the opencode coding agent in the sandbox on the user's own LLM key (BYOK) to write "
            "and edit code from a high-level task description. Prefer 'developer' when the user "
            "asks to 'implement', 'build a feature', or delegate to a 'developer' agent; it is "
            "only available when the user has configured a BYOK key. "
            f"{bg_hint} "
            "Do NOT call sandbox tools directly (via discovery_tool or any other route) for "
            "coding/env work — always go through delegate_to so the noisy shell loop runs in "
            "the engineer's context, not yours. "
            "Do NOT create a GitHub issue or pull request to hand work to a sub-agent — "
            "delegating to yourself by filing a ticket is never correct; call delegate_to instead."
        )
        self.register(self.delegate_to)

    async def delegate_to(
        self, agent_name: str, task: str, background: bool = False
    ) -> str:
        """Delegate a self-contained task to a specialist sub-agent.

        The sub-agent runs its own multi-step loop and returns a concise summary.
        Its intermediate output is NOT shown to you — describe everything it needs
        in `task`.

        Args:
            agent_name: Name of the sub-agent to delegate to (e.g. "sandbox_engineer").
            task: A complete, self-contained description of what to do.
            background: When True, run the work as an autonomous background task that
                survives the turn and streams to the Tasks screen, returning
                immediately with a task id. When False (default), run synchronously
                and return the sub-agent's summary.

        Returns:
            The sub-agent's final summary (sync) or a confirmation with the task id
            (background), or an error message string.
        """
        # NOTE: the first parameter must NOT be named `agent` — Agno reserves that
        # name and injects the calling Agent instance over it, hiding it from the LLM.

        # Background mode: hand the goal to the autonomous task runner. A task must
        # not spawn sub-tasks, so without a spawner (planner/team/inside a task run)
        # we degrade to a synchronous delegation.
        if background:
            if self._spawner is None:
                logger.info(
                    "[Delegation] background requested but no spawner available; "
                    "running '%s' synchronously instead",
                    agent_name,
                )
            else:
                try:
                    task_id = await self._spawner(task)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    logger.error(
                        "[Delegation] Failed to start background task: %s", exc, exc_info=True
                    )
                    return f"Failed to start the background task: {exc}"
                return (
                    f"Started background task {task_id}. It will run autonomously — "
                    "follow the progress on the Tasks screen."
                )

        # Normalize common aliases (e.g. "devops" → "sandbox_engineer") so a natural
        # agent name from the user/LLM still resolves to a registered target.
        resolved = AGENT_ALIASES.get(agent_name.strip().lower(), agent_name)
        builder = self._registry.get(resolved)
        if builder is None and resolved in AGENT_FALLBACKS:
            # e.g. "developer" requested but no BYOK key → use sandbox_engineer.
            fallback = AGENT_FALLBACKS[resolved]
            builder = self._registry.get(fallback)
            if builder is not None:
                logger.info(
                    "[Delegation] '%s' unavailable, falling back to '%s'",
                    resolved,
                    fallback,
                )
                resolved = fallback
        if builder is None:
            available = ", ".join(sorted(self._registry)) or "(none)"
            return (
                f"Unknown agent '{agent_name}'. Available agents: {available}. "
                f"Call delegate_to with one of those."
            )

        logger.info("[Delegation] Delegating to '%s'", resolved)

        # Persist the synchronous delegation as a hidden AgentTask (best-effort):
        # emit a start→terminal lifecycle so the Go listener upserts the row.
        emitter = self._make_emitter(task, resolved)
        plan = [{"id": 0, "title": resolved, "status": "running", "result": ""}]
        await self._safe_emit(
            emitter, "running", plan=plan, kind="step_started",
            payload={"step_id": 0, "title": resolved},
        )

        try:
            target = builder()
            # timeout=None → no wall-clock cap (still cancellable via STOP).
            result: Any = await asyncio.wait_for(
                target.arun(task), timeout=self._timeout
            )
        except asyncio.CancelledError:
            # Stop button: must propagate so the sub-agent run is actually cancelled.
            logger.warning("[Delegation] Delegation to '%s' cancelled", agent_name)
            await self._safe_emit(
                emitter, "cancelled", finished=True, kind="error",
                payload={"reason": "cancelled"},
            )
            raise
        except asyncio.TimeoutError:
            logger.warning(
                "[Delegation] Delegation to '%s' timed out after %ss",
                agent_name,
                self._timeout,
            )
            msg = (
                f"Delegation to '{agent_name}' exceeded the {self._timeout}s time limit "
                f"and was stopped. The task may be too large; try a smaller, more specific task."
            )
            await self._safe_emit(
                emitter, "failed", result=msg, finished=True, kind="error",
                payload={"error": "timeout"},
            )
            return msg
        except Exception as exc:  # noqa: BLE001
            logger.error("[Delegation] Delegation to '%s' failed: %s", agent_name, exc, exc_info=True)
            msg = f"Delegation to '{agent_name}' failed: {exc}"
            await self._safe_emit(
                emitter, "failed", result=msg, finished=True, kind="error",
                payload={"error": str(exc)},
            )
            return msg

        content = getattr(result, "content", None)
        if content is None:
            content = str(result)
        plan[0]["status"] = "done"
        plan[0]["result"] = content
        await self._safe_emit(
            emitter, "done", plan=plan, result=content, finished=True,
            kind="done", payload={"result": content},
        )
        return content

    def _make_emitter(self, task: str, resolved: str) -> Any | None:
        """Build a per-delegation lifecycle emitter, or None if unavailable."""
        if self._emitter_factory is None:
            return None
        try:
            return self._emitter_factory(str(uuid.uuid4()), task, resolved)
        except Exception as exc:  # noqa: BLE001
            logger.debug("[Delegation] emitter init failed: %s", exc)
            return None

    @staticmethod
    async def _safe_emit(emitter: Any | None, status: str, **kwargs: Any) -> None:
        """Emit a task lifecycle update without ever breaking the delegation."""
        if emitter is None:
            return
        try:
            await emitter.emit(status, **kwargs)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.debug("[Delegation] lifecycle emit failed: %s", exc)
