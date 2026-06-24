"""/think low|medium|high|off — sticky reasoning level for this chat.

Persists into ``chats.session_flags.think_level``. On every subsequent message
``redis_session.handle_user_message`` reads the flag and overrides
``current_thinking`` before building the agent — so the level survives across
turns and connection resets without the client having to remember it.
"""

from __future__ import annotations

from src.server.slash_commands.registry import (
    CommandSpec,
    SlashCommandContext,
    register as _register,
)
from src.storage import chat_flags as _default_flags

# Canonical levels match the existing `thinking` param wired through
# AgentFactory.build_model (see back/src/agents/factory.py).
_LEVELS = {"off", "low", "medium", "high"}
_ALIASES = {"med": "medium", "mid": "medium", "hi": "high", "lo": "low", "none": "off"}


def _normalize(arg: str) -> str | None:
    a = arg.strip().lower()
    if not a:
        return None
    a = _ALIASES.get(a, a)
    return a if a in _LEVELS else None


async def handle(ctx: SlashCommandContext, args: str) -> None:
    flags_module = ctx.db_flags_module or _default_flags

    level = _normalize(args)
    if level is None:
        if args.strip():
            await ctx.send_text(
                f"Unknown level '{args.strip()}'. Use: /think off|low|medium|high"
            )
        else:
            flags = await flags_module.get_flags(ctx.chat_id)
            current = flags.get("think_level", "off")
            await ctx.send_text(
                f"Current think level: {current}\nUsage: /think off|low|medium|high"
            )
        return

    flags = await flags_module.set_flag(ctx.chat_id, "think_level", level)
    await ctx.send_session_state(flags)
    if level == "off":
        await ctx.send_text("Thinking disabled.")
    else:
        await ctx.send_text(f"Thinking set to: {level}")


def register() -> None:
    _register(
        CommandSpec(
            name="think",
            summary="sticky reasoning level (off|low|medium|high)",
            usage="<off|low|medium|high>",
            handler=handle,
        )
    )
