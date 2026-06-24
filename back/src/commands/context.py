from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)


@dataclass
class CommandContext:
    """Per-call runtime context for command handlers.

    Carries user id, session/chat ids, tools config, knowledge handle,
    and emit callback. Built once per op=command_call and handed to the handler.

    Two enablers let commands be thin wrappers over existing subsystems:
      - ``model`` + :meth:`complete` — one-shot LLM completions (summaries) without
        spinning up a full agent.
      - ``config_client`` + :meth:`toolkit` — resolve a ready-to-use server-side
        integration toolkit (Gmail, web search, Calendar) with the user's creds.
    """
    user_id: str
    session_id: str | None
    # chat_id is expected to be a UUID-string (e.g. "550e8400-e29b-41d4-a716-446655440000").
    chat_id: str | None
    tools_config: Any  # ToolConfigClient.fetch_tools() result; opaque here
    knowledge: Any  # shared Agno Knowledge; opaque here
    emit: Callable[[dict], Awaitable[None]]
    # Device round-trip for client-only integrations (IMAP, iOS Calendar/Reminders/
    # Health/Contacts). Signature: async (plugin: str, method: str, params: dict) -> str.
    # None when no worker is available to await the device reply.
    client_tool_runner: Callable[[str, str, dict], Awaitable[str]] | None = None
    # Enablers (optional so existing call sites/tests keep working):
    model: Any = None  # Agno Model; built via AgentFactory.build_model(...)
    config_client: Any = None  # ToolConfigClient; fetches per-user ToolsConfig

    async def complete(self, prompt: str) -> str:
        """Run a single non-streaming LLM completion and return the text.

        Mirrors the one-shot call in NomiAgent (`model.aresponse(...)`). Used by
        commands that need deterministic summarization (e.g. email.digest)
        without building a full agent. Returns "" if no model is available.
        """
        if self.model is None:
            logger.warning("CommandContext.complete called with no model")
            return ""
        from agno.models.message import Message

        resp = await self.model.aresponse(
            messages=[Message(role="user", content=prompt)]
        )
        return (getattr(resp, "content", None) or "").strip()

    async def toolkit(self, integration_id: str) -> Any | None:
        """Resolve a ready-to-use server-side integration toolkit.

        Fetches this user's ToolsConfig and builds toolkits via the existing
        tools factory, then returns the first whose name matches ``integration_id``
        (case-insensitive substring, so "gmail" matches "gmail_tools"/"gmail_work").
        Returns None when the integration isn't connected or no client is wired.
        """
        if self.config_client is None:
            logger.warning("CommandContext.toolkit called with no config_client")
            return None
        from src.tools.factory import build as build_tools

        config = await self.config_client.fetch_tools(
            session_id=self.session_id, user_id=self.user_id
        )
        toolkits = await build_tools(
            config, user_id=self.user_id, knowledge=self.knowledge
        )
        key = integration_id.lower()
        for tk in toolkits:
            if key in (getattr(tk, "name", "") or "").lower():
                return tk
        return None
