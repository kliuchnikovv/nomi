"""email.digest command — one-tap summary of recent inbox emails.

Works over either path, whichever the user has connected:
  - server-side Gmail (ctx.toolkit("gmail").get_recent_emails) → structured dicts
  - client-only IMAP (ctx.client_tool_runner("imap", "get_recent_emails", ...))
    → a plain-text "• [uid] from: subject" summary string from the device

Either way we collect a text view of the inbox and ask the model for a short
digest + action items via ctx.complete (one-shot, no agent). requires=() so the
command is always offered; availability is reported as a clear handler error.
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


def _condense_server(messages: list[dict[str, Any]]) -> str:
    lines = []
    for i, msg in enumerate(messages, 1):
        subject = _header(msg, "Subject") or "(no subject)"
        sender = _header(msg, "From") or "(unknown sender)"
        snippet = (msg.get("snippet") or "").strip()
        lines.append(f"{i}. From: {sender}\n   Subject: {subject}\n   {snippet}")
    return "\n".join(lines)


async def _gather_inbox(args: EmailDigestArgs, ctx: CommandContext) -> str | None:
    """Return a text view of the inbox from whichever source is connected.

    Returns "" when the source is connected but empty, or None when no email
    integration is available at all.
    """
    server_tk = await ctx.toolkit("gmail")
    if server_tk is not None:
        await ctx.emit({"type": "reasoning", "message": "Reading your inbox…"})
        messages = await asyncio.to_thread(server_tk.get_recent_emails, args.count)
        return _condense_server(messages) if messages else ""

    if ctx.client_tool_runner is not None:
        await ctx.emit({"type": "reasoning", "message": "Reading your inbox…"})
        # integration_id is resolved on-device when a single IMAP account exists.
        raw = await ctx.client_tool_runner(
            "imap", "get_recent_emails", {"mailbox": "INBOX", "limit": args.count}
        )
        return (raw or "").strip()

    return None


@command(
    name="email.digest",
    title="Summarize my inbox",
    description="Summarize your most recent emails into a short digest with action items.",
    args_model=EmailDigestArgs,
    requires=(),
    surface="chat",
)
async def email_digest(args: EmailDigestArgs, ctx: CommandContext) -> CommandResult:
    try:
        source_text = await _gather_inbox(args, ctx)
    except Exception:
        logger.exception("email.digest fetch failed")
        return CommandResult.error(code="FETCH_FAILED", message="Failed to read your inbox.")

    if source_text is None:
        return CommandResult.error(
            code="email_not_connected",
            message="Connect Gmail or an IMAP account to use /digest.",
        )
    if not source_text:
        return CommandResult.ok(text="Your inbox is empty.", data={"empty": True})

    prompt = (
        "Summarize the following recent emails into a brief digest for the user. "
        "Group by importance, keep it tight, and end with a short 'Action items' "
        "list of anything that needs a reply or decision. Use plain text.\n\n"
        f"{source_text}"
    )
    summary = await ctx.complete(prompt)
    # Model unavailable — fall back to the raw inbox view rather than failing.
    return CommandResult.ok(text=summary or source_text, data={"summarized": bool(summary)})
