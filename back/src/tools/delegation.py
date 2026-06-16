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

    Exposes ``delegate_to(agent_name, task)`` so a lead agent (Nomi) can hand a task to a
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
            "You have access to delegate_to(agent_name, task). Use it to hand a self-contained "
            "task to a specialist sub-agent that owns the work and returns a concise summary. "
            f"Available agents: {targets}. "
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
            "Do NOT call sandbox tools directly (via discovery_tool or any other route) for "
            "coding/env work — always go through delegate_to so the noisy shell loop runs in "
            "the engineer's context, not yours. "
            "Do NOT create a GitHub issue or pull request to hand work to a sub-agent — "
            "delegating to yourself by filing a ticket is never correct; call delegate_to instead."
        )
        self.register(self.delegate_to)

    async def delegate_to(self, agent_name: str, task: str) -> str:
        """Delegate a self-contained task to a specialist sub-agent.

        The sub-agent runs its own multi-step loop and returns a concise summary.
        Its intermediate output is NOT shown to you — describe everything it needs
        in `task`.

        Args:
            agent_name: Name of the sub-agent to delegate to (e.g. "sandbox_engineer").
            task: A complete, self-contained description of what to do.

        Returns:
            The sub-agent's final summary, or an error message string.
        """
        # NOTE: this parameter must NOT be named `agent` — Agno reserves that name
        # and injects the calling Agent instance over it, hiding it from the LLM.
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
        try:
            target = builder()
            # timeout=None → no wall-clock cap (still cancellable via STOP).
            result: Any = await asyncio.wait_for(
                target.arun(task), timeout=self._timeout
            )
        except asyncio.CancelledError:
            # Stop button: must propagate so the sub-agent run is actually cancelled.
            logger.warning("[Delegation] Delegation to '%s' cancelled", agent_name)
            raise
        except asyncio.TimeoutError:
            logger.warning(
                "[Delegation] Delegation to '%s' timed out after %ss",
                agent_name,
                self._timeout,
            )
            return (
                f"Delegation to '{agent_name}' exceeded the {self._timeout}s time limit "
                f"and was stopped. The task may be too large; try a smaller, more specific task."
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("[Delegation] Delegation to '%s' failed: %s", agent_name, exc, exc_info=True)
            return f"Delegation to '{agent_name}' failed: {exc}"

        content = getattr(result, "content", None)
        if content is None:
            content = str(result)
        return content
