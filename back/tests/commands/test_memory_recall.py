"""Tests for memory.recall command.

Read side of memory: knowledge.search(query=..., filters={"user_id": ...},
num_documents=N) returns a list of docs each exposing `.content`.
"""
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
    mod_name = "src.commands.memory_recall"
    if mod_name in sys.modules:
        del sys.modules[mod_name]
    from src.commands import load_commands
    load_commands()


@pytest.fixture(autouse=True)
def _isolate():
    _reset_and_load()
    yield
    CommandRegistry._reset_for_tests()


def _make_ctx(knowledge=None):
    return CommandContext(
        user_id="user-1",
        session_id="sess-1",
        chat_id="chat-1",
        tools_config=None,
        knowledge=knowledge,
        emit=AsyncMock(),
        client_tool_runner=None,
    )


def _doc(content: str):
    d = MagicMock()
    d.content = content
    return d


def test_recall_is_registered():
    spec = CommandRegistry.get("memory.recall")
    assert spec is not None
    assert spec.surface == "chat"
    assert spec.requires == ()


def test_recall_validates_query_required():
    spec = CommandRegistry.get("memory.recall")
    with pytest.raises(ValidationError):
        spec.args_model(query="")


@pytest.mark.asyncio
async def test_recall_searches_with_user_filter():
    spec = CommandRegistry.get("memory.recall")
    knowledge = MagicMock()
    knowledge.search.return_value = [_doc("prefers vegan food"), _doc("lives in Tbilisi")]
    ctx = _make_ctx(knowledge)

    result = await spec.handler(spec.args_model(query="food", limit=3), ctx)

    assert result.ok is True
    knowledge.search.assert_called_once()
    kwargs = knowledge.search.call_args.kwargs
    assert kwargs["query"] == "food"
    assert kwargs["filters"] == {"user_id": "user-1"}
    assert kwargs["num_documents"] == 3
    assert result.data["count"] == 2
    assert "prefers vegan food" in result.text


@pytest.mark.asyncio
async def test_recall_empty_results():
    spec = CommandRegistry.get("memory.recall")
    knowledge = MagicMock()
    knowledge.search.return_value = []
    ctx = _make_ctx(knowledge)

    result = await spec.handler(spec.args_model(query="nothing"), ctx)
    assert result.ok is True
    assert result.data["count"] == 0
    assert "Nothing found" in result.text


@pytest.mark.asyncio
async def test_recall_no_knowledge_error():
    spec = CommandRegistry.get("memory.recall")
    ctx = _make_ctx(knowledge=None)
    result = await spec.handler(spec.args_model(query="x"), ctx)
    assert result.ok is False
    assert result.error["code"] == "NO_KNOWLEDGE"


@pytest.mark.asyncio
async def test_recall_search_failure_error():
    spec = CommandRegistry.get("memory.recall")
    knowledge = MagicMock()
    knowledge.search.side_effect = RuntimeError("vector db down")
    ctx = _make_ctx(knowledge)
    result = await spec.handler(spec.args_model(query="x"), ctx)
    assert result.ok is False
    assert result.error["code"] == "SEARCH_FAILED"
