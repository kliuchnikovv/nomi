"""Tests for web.search command (DuckDuckGo via ctx.toolkit)."""
from __future__ import annotations

import sys

import pytest
from pydantic import ValidationError
from unittest.mock import MagicMock, AsyncMock

from src.commands.registry import CommandRegistry
from src.commands.context import CommandContext


def _reset_and_load():
    CommandRegistry._reset_for_tests()
    import src.commands as pkg
    pkg._loaded = False  # type: ignore[attr-defined]
    mod_name = "src.commands.web_search"
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


def test_web_search_is_registered():
    spec = CommandRegistry.get("web.search")
    assert spec is not None
    assert spec.requires == ()


def test_web_search_validates_query():
    spec = CommandRegistry.get("web.search")
    with pytest.raises(ValidationError):
        spec.args_model(query="")


@pytest.mark.asyncio
async def test_web_search_returns_results():
    spec = CommandRegistry.get("web.search")
    tk = MagicMock()
    tk.duckduckgo_search.return_value = "1. Result one\n2. Result two"
    ctx = _make_ctx()
    ctx.toolkit = AsyncMock(return_value=tk)

    result = await spec.handler(spec.args_model(query="python asyncio", limit=2), ctx)

    assert result.ok is True
    tk.duckduckgo_search.assert_called_once_with("python asyncio", max_results=2)
    assert "Result one" in result.text


@pytest.mark.asyncio
async def test_web_search_unavailable():
    spec = CommandRegistry.get("web.search")
    ctx = _make_ctx()
    ctx.toolkit = AsyncMock(return_value=None)
    result = await spec.handler(spec.args_model(query="x"), ctx)
    assert result.ok is False
    assert result.error["code"] == "WEB_SEARCH_UNAVAILABLE"


@pytest.mark.asyncio
async def test_web_search_failure():
    spec = CommandRegistry.get("web.search")
    tk = MagicMock()
    tk.duckduckgo_search.side_effect = RuntimeError("network")
    ctx = _make_ctx()
    ctx.toolkit = AsyncMock(return_value=tk)
    result = await spec.handler(spec.args_model(query="x"), ctx)
    assert result.ok is False
    assert result.error["code"] == "SEARCH_FAILED"
