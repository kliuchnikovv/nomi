"""Tests for learn.feedback command (Task 15).

The command records explicit user feedback (preference/correction/fact) into
LTM via LearningMachine, with a fallback to knowledge.insert if the LM path
is unavailable.
"""
from __future__ import annotations

import sys

import pytest
from pydantic import ValidationError
from unittest.mock import AsyncMock, MagicMock

from src.commands.registry import CommandRegistry
from src.commands.context import CommandContext


def _reset_and_load():
    CommandRegistry._reset_for_tests()
    import src.commands as pkg
    pkg._loaded = False  # type: ignore[attr-defined]
    for mod_name in list(sys.modules.keys()):
        if "learn_feedback" in mod_name:
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
        user_id="u1",
        session_id="s1",
        chat_id="c1",
        tools_config=None,
        knowledge=knowledge,
        emit=AsyncMock(),
        client_tool_runner=None,
    )


def test_learn_feedback_is_registered():
    spec = CommandRegistry.get("learn.feedback")
    assert spec is not None
    assert spec.name == "learn.feedback"
    assert spec.surface == "chat"


def test_learn_feedback_validates_kind_enum():
    spec = CommandRegistry.get("learn.feedback")
    assert spec is not None
    with pytest.raises(ValidationError):
        spec.args_model(kind="invalid", text="some text")


def test_learn_feedback_validates_text_required():
    spec = CommandRegistry.get("learn.feedback")
    assert spec is not None
    with pytest.raises(ValidationError):
        spec.args_model(kind="preference", text="")


@pytest.mark.asyncio
async def test_learn_feedback_invokes_record(monkeypatch):
    """Happy path: _record is awaited with correct kwargs."""
    spec = CommandRegistry.get("learn.feedback")
    assert spec is not None

    fake = AsyncMock()
    monkeypatch.setattr("src.commands.learn_feedback._record", fake)

    ctx = _make_ctx(knowledge=AsyncMock())
    args = spec.args_model(kind="preference", text="I prefer vegan food")
    result = await spec.handler(args, ctx)

    assert result.ok is True
    assert result.data is not None
    assert result.data["kind"] == "preference"
    fake.assert_awaited_once()
    call_kwargs = fake.await_args.kwargs
    assert call_kwargs["kind"] == "preference"
    assert call_kwargs["user_id"] == "u1"


@pytest.mark.asyncio
async def test_learn_feedback_fallback_on_record_failure(monkeypatch):
    """When _record raises, falls back to knowledge.insert."""
    spec = CommandRegistry.get("learn.feedback")
    assert spec is not None

    monkeypatch.setattr(
        "src.commands.learn_feedback._record",
        AsyncMock(side_effect=RuntimeError("LM unavailable")),
    )

    knowledge = MagicMock()
    ctx = _make_ctx(knowledge=knowledge)
    args = spec.args_model(kind="correction", text="My name is Val, not Valery")
    result = await spec.handler(args, ctx)

    assert result.ok is True
    knowledge.insert.assert_called_once()
    call_kwargs = knowledge.insert.call_args.kwargs
    assert call_kwargs["metadata"]["kind"] == "correction"
    assert call_kwargs["metadata"]["source"] == "command:learn.feedback"
    assert call_kwargs["metadata"]["user_id"] == "u1"


@pytest.mark.asyncio
async def test_learn_feedback_no_backend_error(monkeypatch):
    """When _record raises AND knowledge is None, returns error."""
    spec = CommandRegistry.get("learn.feedback")
    assert spec is not None

    monkeypatch.setattr(
        "src.commands.learn_feedback._record",
        AsyncMock(side_effect=RuntimeError("LM unavailable")),
    )

    ctx = _make_ctx(knowledge=None)
    args = spec.args_model(kind="fact", text="I live in Berlin")
    result = await spec.handler(args, ctx)

    assert result.ok is False
    assert result.error is not None
    assert result.error["code"] == "no_backend"


@pytest.mark.asyncio
async def test_learn_feedback_all_kind_values():
    """All three kind values are accepted."""
    spec = CommandRegistry.get("learn.feedback")
    assert spec is not None
    for kind in ("preference", "correction", "fact"):
        args = spec.args_model(kind=kind, text="test")
        assert args.kind == kind
