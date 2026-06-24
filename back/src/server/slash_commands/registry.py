"""Slash-command registry, parser, and dispatcher.

Handlers are plain async callables ``async def handle(ctx, args) -> None``.
They emit user-visible output via ``ctx.send_text`` and side-effect via
``ctx.send_session_state``. The dispatcher always closes the turn with a
DONE frame so the Go hub treats this as a complete reply.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from src.server.models import Frame, Op
from src.server.utils import make_data, make_done, make_meta

logger = logging.getLogger(__name__)

# Matches a leading slash command: "/foo bar baz" → ("foo", "bar baz").
_SLASH_RE = re.compile(r"^\s*/([a-zA-Z_][a-zA-Z0-9_-]*)\s*(.*?)\s*$", re.DOTALL)


@dataclass
class CommandSpec:
    name: str
    summary: str  # one-liner for /help
    handler: Callable[["SlashCommandContext", str], Awaitable[None]]
    usage: str = ""  # optional argument syntax shown by /help


_REGISTRY: dict[str, CommandSpec] = {}


def register(spec: CommandSpec) -> None:
    if spec.name in _REGISTRY:
        raise ValueError(f"duplicate slash command: /{spec.name}")
    _REGISTRY[spec.name] = spec


def all_commands() -> list[CommandSpec]:
    return sorted(_REGISTRY.values(), key=lambda s: s.name)


@dataclass
class SlashCommandContext:
    """Carries everything a handler needs to read state and emit frames.

    The session passes ``send_frame`` so handlers don't import RedisSession
    directly (avoids a cycle and keeps handlers unit-testable).
    """

    user_id: str | None
    chat_id: str
    session_id: str
    payload: dict[str, Any]
    agent_storage_mode: str  # "agno" | "payload"
    send_frame: Callable[[Frame], Awaitable[Any]]
    next_id_fn: Callable[[], int]
    redis_client: Any = None
    # Agno PostgresDb (for session deletion / message lookup). May be None in
    # tests or when the agent factory hasn't initialised it yet.
    agno_db: Any = None
    # Optional model builder ``(model_name: str) -> Model`` for handlers that
    # need an ad-hoc LLM call (e.g. /compact). May be None.
    build_model: Callable[[str], Any] | None = None
    # Optional injection for tests; defaults to the production helper.
    db_flags_module: Any = field(default=None)

    async def send_text(self, message: str) -> None:
        await self.send_frame(
            make_data(
                self.next_id_fn(),
                Op.MESSAGE,
                self.chat_id,
                {"type": "text", "message": message},
            )
        )

    async def send_session_state(self, flags: dict[str, Any]) -> None:
        await self.send_frame(
            make_meta(
                self.next_id_fn(),
                Op.SESSION_STATE,
                self.chat_id,
                {
                    "type": "session_state",
                    "flags": flags,
                    "storage_mode": self.agent_storage_mode,
                },
            )
        )

    async def send_done(self) -> None:
        await self.send_frame(make_done(self.next_id_fn(), self.chat_id))


def parse(text: str) -> tuple[str, str] | None:
    """Return ``(cmd, args)`` if ``text`` is a slash command, else ``None``."""
    if not text:
        return None
    m = _SLASH_RE.match(text)
    if not m:
        return None
    return m.group(1).lower(), (m.group(2) or "").strip()


async def dispatch(text: str, ctx: SlashCommandContext) -> bool:
    """Try to handle ``text`` as a slash command. Return True if handled.

    On True, the caller MUST NOT proceed into the agent — a DONE frame is
    already sent. On False, ``text`` was not a slash command.
    """
    parsed = parse(text)
    if parsed is None:
        return False

    cmd, args = parsed
    spec = _REGISTRY.get(cmd)

    try:
        if spec is None:
            await ctx.send_text(f"Unknown command '/{cmd}'. Try /help.")
        else:
            await spec.handler(ctx, args)
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("[slash_commands] /%s failed: %s", cmd, exc)
        await ctx.send_text(f"Command '/{cmd}' failed: {exc}")

    await ctx.send_done()
    return True


def _register_builtin_handlers() -> None:
    from src.server.slash_commands.handlers import help as help_handler
    from src.server.slash_commands.handlers import status as status_handler
    from src.server.slash_commands.handlers import compact as compact_handler
    from src.server.slash_commands.handlers import forget as forget_handler
    from src.server.slash_commands.handlers import reset as reset_handler
    from src.server.slash_commands.handlers import think as think_handler
    from src.server.slash_commands.handlers import usage as usage_handler

    help_handler.register()
    status_handler.register()
    think_handler.register()
    usage_handler.register()
    reset_handler.register()
    compact_handler.register()
    forget_handler.register()


_register_builtin_handlers()
