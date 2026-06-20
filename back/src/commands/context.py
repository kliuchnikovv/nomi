from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable


@dataclass
class CommandContext:
    """Per-call runtime context for command handlers.

    Carries user id, session/chat ids, tools config, knowledge handle,
    and emit callback. Built once per op=command_call and handed to the handler.
    """
    user_id: str
    session_id: str | None
    # chat_id is expected to be a UUID-string (e.g. "550e8400-e29b-41d4-a716-446655440000").
    chat_id: str | None
    tools_config: Any  # ToolConfigClient.fetch_tools() result; opaque here
    knowledge: Any  # shared Agno Knowledge; opaque here
    emit: Callable[[dict], Awaitable[None]]
    client_tool_runner: Callable | None = None
