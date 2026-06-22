"""email.digest command — one-tap summary of recent inbox emails.

Pulls recent messages from the connected Gmail account, condenses subject/from/
snippet into a compact prompt, and asks the model for a short digest + action
list. The Gmail toolkit method is synchronous (blocking HTTP), so it runs in a
worker thread; the model call uses ctx.complete (one-shot, no agent).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from pydantic import BaseModel, Field

from src.commands.base import CommandResult, command
from src.commands.context import CommandContext

logger = logging.getLogger(__name__)


class EmailDigestArgs(BaseModel):
    count: int = Field(10, ge=1, le=25, description="How many recent emails to summarize")


def _header(msg: dict[str, Any], name: str) -> str:
    """Pull a header value (case-insensitive) from a Gmail message dict."""
    headers = (((msg or {}).get("payload") or {}).get("headers")) or []
    target = name.lower()
    for h in headers:
        if isinstance(h, dict) and (h.get("name", "").lower() == target):
            return h.get("value", "") or ""
    return ""


def _condense(messages: list[dict[str, Any]]) -> str:
    lines = []
    for i, msg in enumerate(messages, 1):
        subject = _header(msg, "Subject") or "(no subject)"
        sender = _header(msg, "From") or "(unknown sender)"
        snippet = (msg.get("snippet") or "").strip()
        lines.append(f"{i}. From: {sender}\n   Subject: {subject}\n   {snippet}")
    return "\n".join(lines)


@command(
    name="email.digest",
    title="Summarize my inbox",
    description="Summarize your most recent emails into a short digest with action items.",
    args_model=EmailDigestArgs,
    requires=("gmail",),
    surface="chat",
)
async def email_digest(args: EmailDigestArgs, ctx: CommandContext) -> CommandResult:
    tk = await ctx.toolkit("gmail")
    if tk is None:
        return CommandResult.error(
            code="gmail_not_connected",
            message="Connect a Gmail account to use /digest.",
        )

    await ctx.emit({"type": "reasoning", "message": "Reading your inbox…"})

    try:
        messages = await asyncio.to_thread(tk.get_recent_emails, args.count)
    except Exception:
        logger.exception("email.digest fetch failed")
        return CommandResult.error(
            code="FETCH_FAILED",
            message="Failed to read your inbox.",
        )

    if not messages:
        return CommandResult.ok(text="Your inbox is empty.", data={"count": 0})

    prompt = (
        "Summarize the following recent emails into a brief digest for the user. "
        "Group by importance, keep it tight, and end with a short 'Action items' "
        "list of anything that needs a reply or decision. Use plain text.\n\n"
        f"{_condense(messages)}"
    )
    summary = await ctx.complete(prompt)
    if not summary:
        # Model unavailable — degrade to a plain subject list rather than failing.
        subjects = [f"• {_header(m, 'Subject') or '(no subject)'}" for m in messages]
        summary = "Recent emails:\n" + "\n".join(subjects)

    return CommandResult.ok(text=summary, data={"count": len(messages)})
