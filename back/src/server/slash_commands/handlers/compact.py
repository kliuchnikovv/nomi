"""/compact — summarize current session into a single text block.

Flow:
  1. Pull the Agno session and concatenate user/assistant content from its runs.
  2. Call a small model to compress into 1-2 paragraphs.
  3. Persist into ``chats.session_flags.compact_summary`` + ``compact_at``.
  4. Delete the Agno session so future turns don't re-load the full history.
  5. ``redis_session.handle_user_message`` prepends the summary to the next
     user message — that's how the agent retains the compressed context.

If anything is missing (no agno_db, no build_model, empty session, payload
mode) the handler reports honestly instead of pretending to work.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from src.server.slash_commands.registry import (
    CommandSpec,
    SlashCommandContext,
    register as _register,
)
from src.storage import chat_flags as _default_flags

logger = logging.getLogger(__name__)

# Bound the prompt — long conversations can blow the context window of the
# summarizer otherwise. ~16k chars ≈ 4k tokens — fits any small model.
_MAX_CHARS = 16_000

_SUMMARY_MODEL = "gpt-4o-mini"

_SUMMARY_PROMPT = (
    "Summarize the conversation below in 1-2 paragraphs. Preserve concrete "
    "facts, names, decisions, open questions, and the user's stated "
    "preferences. Omit pleasantries. Write in the same language as the user. "
    "Do not address the user — write a neutral third-person recap.\n\n"
    "--- CONVERSATION ---\n{body}\n--- END ---\n\nSummary:"
)


def _runs_to_text(runs: list[Any]) -> str:
    """Flatten Agno session runs into a chronological transcript."""
    lines: list[str] = []
    for run in runs or []:
        # `runs` items may be dicts (loaded from DB) or RunOutput objects.
        input_val = _get(run, "input")
        if input_val:
            lines.append(f"USER: {_stringify(input_val)}")
        content = _get(run, "content")
        if content:
            lines.append(f"ASSISTANT: {_stringify(content)}")
    text = "\n".join(line.strip() for line in lines if line.strip())
    if len(text) > _MAX_CHARS:
        # Keep the tail — most recent turns matter more than ancient ones.
        text = "[…earlier turns truncated…]\n" + text[-_MAX_CHARS:]
    return text


def _get(obj: Any, attr: str) -> Any:
    if isinstance(obj, dict):
        return obj.get(attr)
    return getattr(obj, attr, None)


def _stringify(val: Any) -> str:
    if isinstance(val, str):
        return val
    if isinstance(val, dict):
        # RunInput sometimes serialises as {"input_content": "...", "messages": [...]}
        for k in ("input_content", "content", "message", "text"):
            v = val.get(k)
            if isinstance(v, str) and v.strip():
                return v
        return str(val)
    return str(val)


async def _summarize(model: Any, body: str) -> str:
    """Run a single one-shot LLM call. Returns the summary string."""
    from agno.models.message import Message

    prompt = _SUMMARY_PROMPT.format(body=body)
    response = await model.aresponse(messages=[Message(role="user", content=prompt)])
    content = getattr(response, "content", None) or str(response)
    return str(content).strip()


async def handle(ctx: SlashCommandContext, args: str) -> None:
    flags_module = ctx.db_flags_module or _default_flags

    if ctx.agno_db is None or ctx.build_model is None:
        await ctx.send_text(
            "/compact is unavailable: the agent's DB or model factory is not "
            "ready. Try again after the first turn."
        )
        return

    # Pull session — works only for agno-backed sessions. In payload mode the
    # history lives in the API's `messages` table and isn't reachable from here
    # without a Go round-trip. Fall back honestly.
    session = None
    session_type: object | None = None
    try:
        # SessionType lives at agno.db.base in production; tests stub agno.db
        # without that submodule, so we tolerate either path being missing.
        from agno.db.base import SessionType  # type: ignore

        session_type = SessionType.AGENT
    except Exception:
        session_type = None
    try:
        session = ctx.agno_db.get_session(
            ctx.session_id, session_type, deserialize=True
        )
    except Exception as exc:
        logger.warning("[compact] get_session failed: %s", exc)

    runs = _get(session, "runs") if session else None
    body = _runs_to_text(runs or [])
    if not body:
        await ctx.send_text(
            "Nothing to compact: no session history found "
            f"(storage_mode={ctx.agent_storage_mode})."
        )
        return

    try:
        model = ctx.build_model(_SUMMARY_MODEL)
    except Exception as exc:
        logger.warning("[compact] build_model failed: %s", exc)
        await ctx.send_text(f"/compact failed: cannot build summary model ({exc}).")
        return

    try:
        summary = await _summarize(model, body)
    except Exception as exc:
        logger.exception("[compact] summarize failed: %s", exc)
        await ctx.send_text(f"/compact failed during summary: {exc}.")
        return

    if not summary:
        await ctx.send_text("/compact failed: empty summary returned.")
        return

    new_flags = await flags_module.set_flag(ctx.chat_id, "compact_summary", summary)
    new_flags = await flags_module.set_flag(ctx.chat_id, "compact_at", int(time.time()))

    deleted = False
    try:
        deleted = bool(ctx.agno_db.delete_session(ctx.session_id))
    except Exception as exc:
        logger.warning("[compact] delete_session failed: %s", exc)

    await ctx.send_session_state(new_flags)

    chars = len(summary)
    parts = [f"Session compacted: {chars} chars saved as summary"]
    if deleted:
        parts.append("history wiped")
    parts.append("will be injected as context on the next message")
    await ctx.send_text(". ".join(parts) + ".")


def register() -> None:
    _register(
        CommandSpec(
            name="compact",
            summary="summarize session history into a single block",
            handler=handle,
        )
    )
