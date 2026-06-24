"""Tests for email.digest — server Gmail OR client IMAP, summarized via ctx.complete."""
from __future__ import annotations

import sys

import pytest
from unittest.mock import MagicMock, AsyncMock

from src.commands.registry import CommandRegistry
from src.commands.context import CommandContext


def _reset_and_load():
    CommandRegistry._reset_for_tests()
    import src.commands as pkg
    pkg._loaded = False  # type: ignore[attr-defined]
    mod_name = "src.commands.email_digest"
    if mod_name in sys.modules:
        del sys.modules[mod_name]
    from src.commands import load_commands
    load_commands()


@pytest.fixture(autouse=True)
def _isolate():
    _reset_and_load()
    yield
    CommandRegistry._reset_for_tests()


def _make_ctx():
    return CommandContext(
        user_id="user-1",
        session_id="sess-1",
        chat_id="chat-1",
        tools_config=None,
        knowledge=None,
        emit=AsyncMock(),
        client_tool_runner=None,
    )


def _msg(subject: str, sender: str, snippet: str):
    return {
        "snippet": snippet,
        "payload": {"headers": [
            {"name": "Subject", "value": subject},
            {"name": "From", "value": sender},
        ]},
    }


def test_digest_is_registered_with_no_requires():
    spec = CommandRegistry.get("email.digest")
    assert spec is not None
    assert spec.requires == ()  # always offered; availability handled in handler


@pytest.mark.asyncio
async def test_digest_via_server_gmail():
    spec = CommandRegistry.get("email.digest")
    tk = MagicMock()
    tk.get_recent_emails.return_value = [
        _msg("Invoice due", "billing@acme.com", "Your invoice is due Friday"),
        _msg("Lunch?", "bob@x.gg", "Free tomorrow?"),
    ]
    ctx = _make_ctx()
    ctx.toolkit = AsyncMock(return_value=tk)
    ctx.complete = AsyncMock(return_value="Digest: 2 emails. Action: pay invoice.")

    result = await spec.handler(spec.args_model(count=5), ctx)

    assert result.ok is True
    tk.get_recent_emails.assert_called_once_with(5)
    prompt = ctx.complete.call_args.args[0]
    assert "Invoice due" in prompt and "billing@acme.com" in prompt
    assert result.text == "Digest: 2 emails. Action: pay invoice."


@pytest.mark.asyncio
async def test_digest_via_device_imap_when_no_server():
    spec = CommandRegistry.get("email.digest")
    ctx = _make_ctx()
    ctx.toolkit = AsyncMock(return_value=None)  # no server Gmail
    ctx.client_tool_runner = AsyncMock(
        return_value="Found 2 recent emails in INBOX:\n\n• [12] a@b.c: Hi\n• [13] c@d.e: Yo"
    )
    ctx.complete = AsyncMock(return_value="Digest from IMAP.")

    result = await spec.handler(spec.args_model(count=10), ctx)

    assert result.ok is True
    ctx.client_tool_runner.assert_awaited_once()
    plugin, method, params = ctx.client_tool_runner.call_args.args
    assert plugin == "imap" and method == "get_recent_emails"
    assert params["limit"] == 10 and params["mailbox"] == "INBOX"
    assert result.text == "Digest from IMAP."


@pytest.mark.asyncio
async def test_digest_no_email_integration():
    spec = CommandRegistry.get("email.digest")
    ctx = _make_ctx()
    ctx.toolkit = AsyncMock(return_value=None)
    ctx.client_tool_runner = None
    result = await spec.handler(spec.args_model(), ctx)
    assert result.ok is False
    assert result.error["code"] == "email_not_connected"


@pytest.mark.asyncio
async def test_digest_empty_inbox():
    spec = CommandRegistry.get("email.digest")
    tk = MagicMock()
    tk.get_recent_emails.return_value = []
    ctx = _make_ctx()
    ctx.toolkit = AsyncMock(return_value=tk)
    result = await spec.handler(spec.args_model(), ctx)
    assert result.ok is True
    assert result.data["empty"] is True


@pytest.mark.asyncio
async def test_digest_degrades_without_model():
    spec = CommandRegistry.get("email.digest")
    tk = MagicMock()
    tk.get_recent_emails.return_value = [_msg("Hi", "a@b.c", "yo")]
    ctx = _make_ctx()
    ctx.toolkit = AsyncMock(return_value=tk)
    ctx.complete = AsyncMock(return_value="")  # model unavailable

    result = await spec.handler(spec.args_model(), ctx)
    assert result.ok is True
    assert "Hi" in result.text  # falls back to the raw inbox view
    assert result.data["summarized"] is False
