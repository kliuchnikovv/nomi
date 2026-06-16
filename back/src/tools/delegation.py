from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

from agno.agent import Agent
from agno.tools import Toolkit

logger = logging.getLogger(__name__)

# Overall wall-clock cap for a single delegation, so a runaway sub-agent can't
# loop forever in the sandbox. Per-command timeouts in exec_command apply too.
DELEGATION_TIMEOUT = 300

AgentBuilder = Callable[[], Agent]

# Common names users (and the LLM) reach for, mapped to the real registry key.
# Applied case-insensitively before the registry lookup so delegate_to("devops", ...)
# resolves to the sandbox engineer instead of failing as "Unknown agent".
AGENT_ALIASES = {
    "devops": "sandbox_engineer",
    "dev_ops": "sandbox_engineer",
    "engineer": "sandbox_engineer",
    "sandbox": "sandbox_engineer",
    "developer": "sandbox_engineer",
    "coder": "sandbox_engineer",
}


class DelegationTools(Toolkit):
    """Generic delegation tool.

    Exposes ``delegate_to(agent, task)`` so a lead agent (Nomi) can hand a task to a
    registered specialist sub-agent/team. The sub-agent owns its own multi-step loop
    and only its final summary flows back, keeping the caller's context clean.

    The registry is a fixed allowlist of buildable targets, keyed by name. Targets are
    built lazily (only when actually delegated to).
    """

    def __init__(
        self,
        registry: dict[str, AgentBuilder],
        timeout: float | None = DELEGATION_TIMEOUT,
    ):
        super().__init__(name="delegation")
        self._registry = registry
        # Wall-clock cap per delegation. None disables it (task mode, where the
        # task runner + STOP own cancellation and runs are meant to be long).
        self._timeout = timeout
        # Surface available targets in the tool description so the model knows who
        # it can delegate to.
        targets = ", ".join(sorted(registry)) or "(none)"
        self.add_instructions = True
        self.instructions = (
            "You have access to delegate_to(agent, task). Use it to hand a self-contained "
            "task to a specialist sub-agent that owns the work and returns a concise summary. "
            f"Available agents: {targets}. "
            "Pass everything the sub-agent needs in `task` — it does not see the chat history. "
            "Use 'sandbox_engineer' for anything that needs running, building, installing, or "
            "testing code in an isolated Linux sandbox — including setting up a development "
            "environment, installing dependencies, and writing or running tests (e2e, unit, etc.). "
            "If the user asks to delegate work to a 'devops', 'engineer', or 'developer' agent, "
            "that is sandbox_engineer. "
            "Do NOT call sandbox tools directly (via discovery_tool or any other route) for "
            "coding/env work — always go through delegate_to so the noisy shell loop runs in "
            "the engineer's context, not yours. "
            "Do NOT create a GitHub issue or pull request to hand work to a sub-agent — "
            "delegating to yourself by filing a ticket is never correct; call delegate_to instead."
        )
        self.register(self.delegate_to)

    async def delegate_to(self, agent: str, task: str) -> str:
        """Delegate a self-contained task to a specialist sub-agent.

        The sub-agent runs its own multi-step loop and returns a concise summary.
        Its intermediate output is NOT shown to you — describe everything it needs
        in `task`.

        Args:
            agent: Name of the sub-agent to delegate to (e.g. "sandbox_engineer").
            task: A complete, self-contained description of what to do.

        Returns:
            The sub-agent's final summary, or an error message string.
        """
        # Normalize common aliases (e.g. "devops" → "sandbox_engineer") so a natural
        # agent name from the user/LLM still resolves to a registered target.
        resolved = AGENT_ALIASES.get(agent.strip().lower(), agent)
        builder = self._registry.get(resolved)
        if builder is None:
            available = ", ".join(sorted(self._registry)) or "(none)"
            return (
                f"Unknown agent '{agent}'. Available agents: {available}. "
                f"Call delegate_to with one of those."
            )

        logger.info("[Delegation] Delegating to '%s'", resolved)
        try:
            target = builder()
            # timeout=None → no wall-clock cap (still cancellable via STOP).
            result: Any = await asyncio.wait_for(
                target.arun(task), timeout=self._timeout
            )
        except asyncio.CancelledError:
            # Stop button: must propagate so the sub-agent run is actually cancelled.
            logger.warning("[Delegation] Delegation to '%s' cancelled", agent)
            raise
        except asyncio.TimeoutError:
            logger.warning(
                "[Delegation] Delegation to '%s' timed out after %ss",
                agent,
                self._timeout,
            )
            return (
                f"Delegation to '{agent}' exceeded the {self._timeout}s time limit "
                f"and was stopped. The task may be too large; try a smaller, more specific task."
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("[Delegation] Delegation to '%s' failed: %s", agent, exc, exc_info=True)
            return f"Delegation to '{agent}' failed: {exc}"

        content = getattr(result, "content", None)
        if content is None:
            content = str(result)
        return content
