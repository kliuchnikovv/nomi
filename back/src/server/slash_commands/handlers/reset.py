"""/reset — wipe Agno session + soft-archive payload-mode messages.

Two-step confirmation (Redis-backed pending, 120 s TTL). NOT touched:
LTM memories, RAG (``personal_vectors``), plugin data.
"""

from __future__ import annotations

import logging

from src.server.slash_commands import pending
from src.server.slash_commands.registry import (
    CommandSpec,
    SlashCommandContext,
    register as _register,
)
from src.storage import chat_flags as _default_flags
from src.storage import chat_flags  # for _write_flags / SQL access

logger = logging.getLogger(__name__)

_PREVIEW = (
    "/reset will:\n"
    "  • wipe this chat's session history\n"
    "  • clear sticky flags (/think, /compact)\n"
    "It will NOT touch: LTM memories, RAG, plugin data.\n\n"
    "Reply /reset within 2 minutes to confirm. Any other input cancels."
)


async def _archive_payload_messages(chat_id: str, user_id: str) -> int:
    """Soft-archive all messages of a chat. Returns row count (0 on no DB)."""
    import asyncpg

    dsn = chat_flags._get_dsn()
    if not dsn:
        return 0
    conn = await asyncpg.connect(chat_flags._normalize_dsn(dsn))
    try:
        result = await conn.execute(
            "UPDATE messages SET archived = true, updated_at = NOW() "
            "WHERE chat_id = $1::uuid AND user_id = $2::uuid AND archived = false",
            chat_id,
            user_id,
        )
    finally:
        await conn.close()
    # asyncpg returns e.g. "UPDATE 7"
    try:
        return int(result.split()[-1])
    except (ValueError, IndexError):
        return 0


async def handle(ctx: SlashCommandContext, args: str) -> None:
    flags_module = ctx.db_flags_module or _default_flags
    existing = await pending.get_pending(ctx.redis_client, ctx.user_id or "", ctx.chat_id)

    if not existing or existing.get("cmd") != "reset":
        # Step 1: preview + arm pending.
        await pending.set_pending(
            ctx.redis_client, ctx.user_id or "", ctx.chat_id, "reset"
        )
        await ctx.send_text(_PREVIEW)
        return

    # Step 2: confirmed — execute.
    await pending.clear(ctx.redis_client, ctx.user_id or "", ctx.chat_id)

    agno_cleared = False
    if ctx.agno_db is not None:
        try:
            agno_cleared = bool(ctx.agno_db.delete_session(ctx.session_id))
        except Exception as exc:
            logger.warning("[reset] Agno delete_session failed: %s", exc)

    archived = 0
    if ctx.user_id:
        try:
            archived = await _archive_payload_messages(ctx.chat_id, ctx.user_id)
        except Exception as exc:
            logger.warning("[reset] archive messages failed: %s", exc)

    await flags_module.clear_flags(ctx.chat_id)
    await ctx.send_session_state({})

    bits = []
    if agno_cleared:
        bits.append("Agno session deleted")
    if archived:
        bits.append(f"{archived} messages archived")
    if not bits:
        bits.append("no history to clear")
    await ctx.send_text("Reset complete: " + ", ".join(bits) + ".")


def register() -> None:
    _register(
        CommandSpec(
            name="reset",
            summary="wipe session history (two-step confirm)",
            handler=handle,
        )
    )
