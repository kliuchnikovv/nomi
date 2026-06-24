"""/forget <substring> — delete user memories matching a substring (two-step).

Step 1: list up to 10 matches and arm pending state with their memory_ids
(NOT the substring — otherwise a new memory created between steps could be
swept up unintentionally).

Step 2: ``/forget <same substring>`` within 2 minutes deletes exactly the
ids captured in step 1.
"""

from __future__ import annotations

import logging
from typing import Any

from src.server.slash_commands import pending
from src.server.slash_commands.registry import (
    CommandSpec,
    SlashCommandContext,
    register as _register,
)

logger = logging.getLogger(__name__)

_MAX_RESULTS = 10
_PREVIEW_CHARS = 80


def _mem_field(mem: Any, name: str) -> Any:
    if isinstance(mem, dict):
        return mem.get(name)
    return getattr(mem, name, None)


def _short(text: str) -> str:
    text = text.replace("\n", " ").strip()
    return text if len(text) <= _PREVIEW_CHARS else text[: _PREVIEW_CHARS - 1] + "…"


async def _search(ctx: SlashCommandContext, substring: str) -> list[tuple[str, str]]:
    """Return [(memory_id, memory_text), ...] for matches. At most _MAX_RESULTS+1
    items — caller uses the +1 to detect 'too broad' without a second query.
    """
    if ctx.agno_db is None or not ctx.user_id:
        return []
    # `search_content` runs a SQL substring filter server-side and is case-
    # insensitive in Agno's Postgres implementation.
    raw = ctx.agno_db.get_user_memories(
        user_id=ctx.user_id,
        search_content=substring,
        limit=_MAX_RESULTS + 1,
    )
    # API returns either a List[UserMemory] (deserialize=True) or a
    # (rows, total_count) tuple when deserialize=False — guard both.
    if isinstance(raw, tuple):
        raw = raw[0]
    out: list[tuple[str, str]] = []
    for mem in raw or []:
        mid = _mem_field(mem, "memory_id")
        text = _mem_field(mem, "memory") or ""
        if mid:
            out.append((str(mid), str(text)))
    return out


async def handle(ctx: SlashCommandContext, args: str) -> None:
    substring = args.strip()
    if not substring:
        await ctx.send_text("Usage: /forget <substring>")
        return

    if ctx.agno_db is None or not ctx.user_id:
        await ctx.send_text(
            "/forget is unavailable (memory store not ready)."
        )
        return

    existing = await pending.get_pending(
        ctx.redis_client, ctx.user_id, ctx.chat_id
    )

    # Step 2 — same substring within 2 min → execute deletion.
    if (
        existing
        and existing.get("cmd") == "forget"
        and (existing.get("data") or {}).get("substring") == substring.lower()
    ):
        ids = list((existing.get("data") or {}).get("ids") or [])
        await pending.clear(ctx.redis_client, ctx.user_id, ctx.chat_id)
        if not ids:
            await ctx.send_text("Nothing to forget — no ids captured.")
            return
        try:
            ctx.agno_db.delete_user_memories(memory_ids=ids, user_id=ctx.user_id)
        except Exception as exc:
            logger.exception("[forget] delete failed: %s", exc)
            await ctx.send_text(f"/forget failed: {exc}")
            return
        plural = "memory" if len(ids) == 1 else "memories"
        await ctx.send_text(f"Forgot {len(ids)} {plural}.")
        return

    # Step 1 — show matches and arm pending.
    try:
        matches = await _search(ctx, substring)
    except Exception as exc:
        logger.exception("[forget] search failed: %s", exc)
        await ctx.send_text(f"/forget search failed: {exc}")
        return

    if not matches:
        await ctx.send_text(f"No memories matching '{substring}'.")
        return

    if len(matches) > _MAX_RESULTS:
        await ctx.send_text(
            f"Found more than {_MAX_RESULTS} memories matching '{substring}'. "
            "Narrow your query."
        )
        return

    ids = [mid for mid, _ in matches]
    await pending.set_pending(
        ctx.redis_client,
        ctx.user_id,
        ctx.chat_id,
        "forget",
        {"substring": substring.lower(), "ids": ids},
    )

    lines = [f"Found {len(matches)} memories matching '{substring}':"]
    for i, (_, text) in enumerate(matches, 1):
        lines.append(f"  {i}. {_short(text)}")
    lines.append("")
    lines.append(
        f"Reply '/forget {substring}' within 2 minutes to delete them. "
        "Any other input cancels."
    )
    await ctx.send_text("\n".join(lines))


def register() -> None:
    _register(
        CommandSpec(
            name="forget",
            summary="delete memories matching a substring (two-step)",
            usage="<substring>",
            handler=handle,
        )
    )
