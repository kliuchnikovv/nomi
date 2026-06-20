"""Tests for memory.note command (Task 3).

The canonical knowledge write path in this codebase is:
    knowledge.insert(text_content=..., metadata={"user_id": user_id})
(sync call, same as _extract_and_store_facts in redis_session.py lines ~1300, ~1514)

load_commands() is NOT idempotent once _loaded=True, so we reset the module-level
flag and the registry before/after each test to keep isolation tight.
"""
from __future__ import annotations

import sys

import pytest
from pydantic import ValidationError
from unittest.mock import MagicMock, AsyncMock

from src.commands.registry import CommandRegistry
from src.commands.context import CommandContext


def _reset_and_load():
    """Reset registry and module _loaded flag, then re-import memory_note."""
    CommandRegistry._reset_for_tests()
    # Reset the _loaded sentinel so load_commands() re-scans
    import src.commands as pkg
    pkg._loaded = False  # type: ignore[attr-defined]
    # Force re-import of memory_note module to re-run @command decorator
    mod_name = "src.commands.memory_note"
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


def test_memory_note_is_registered():
    spec = CommandRegistry.get("memory.note")
    assert spec is not None
    assert spec.name == "memory.note"
    assert spec.surface == "chat"


def test_memory_note_validates_text_required():
    spec = CommandRegistry.get("memory.note")
    assert spec is not None
    with pytest.raises(ValidationError):
        spec.args_model(text="")  # min_length=1


@pytest.mark.asyncio
async def test_memory_note_inserts_with_user_id():
    spec = CommandRegistry.get("memory.note")
    knowledge = MagicMock()
    ctx = _make_ctx(knowledge)

    args = spec.args_model(text="prefer vegan food", tags=["preference"])
    result = await spec.handler(args, ctx)

    assert result.ok is True
    knowledge.insert.assert_called_once()
    call_kwargs = knowledge.insert.call_args.kwargs
    assert call_kwargs["text_content"] == "prefer vegan food"
    assert call_kwargs["metadata"]["user_id"] == "user-1"
    assert call_kwargs["metadata"]["tags"] == ["preference"]
    assert call_kwargs["metadata"]["source"] == "command:memory.note"


@pytest.mark.asyncio
async def test_memory_note_returns_chars_in_data():
    spec = CommandRegistry.get("memory.note")
    ctx = _make_ctx(MagicMock())
    text = "some note"
    result = await spec.handler(spec.args_model(text=text), ctx)
    assert result.ok is True
    assert result.data is not None
    assert result.data["chars"] == len(text)


@pytest.mark.asyncio
async def test_memory_note_no_knowledge_error():
    spec = CommandRegistry.get("memory.note")
    ctx = _make_ctx(knowledge=None)
    result = await spec.handler(spec.args_model(text="hi"), ctx)
    assert result.ok is False
    assert result.error["code"] == "NO_KNOWLEDGE"


@pytest.mark.asyncio
async def test_memory_note_insert_failure_error():
    spec = CommandRegistry.get("memory.note")
    knowledge = MagicMock()
    knowledge.insert.side_effect = RuntimeError("db down")
    ctx = _make_ctx(knowledge)

    result = await spec.handler(spec.args_model(text="hi"), ctx)
    assert result.ok is False
    assert result.error["code"] == "INSERT_FAILED"
