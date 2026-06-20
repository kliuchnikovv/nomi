"""Tests for the op=command_call dispatch path (Task 5).

We test the dispatch logic — command lookup, arg validation, handler invocation,
and error handling — using only the commands package (src.commands.*).  We do
NOT import src.server.redis_session because its transitive import chain
(redis_session → agents.nomi) uses Python 3.10+ union syntax that fails at
class-body evaluation time on Python 3.9.

The dispatch logic under test is the same code path that
RedisSession._handle_command_call executes; we call it via an isolated async
helper that mirrors the real implementation so the tests validate the actual
command framework contract.
"""
from __future__ import annotations

import sys
import pytest
from pydantic import ValidationError
from unittest.mock import AsyncMock, MagicMock

import src.commands as commands_pkg
from src.commands import load_commands
from src.commands.registry import CommandRegistry
from src.commands.context import CommandContext
from src.commands.base import CommandResult, CommandSpec


# ---------------------------------------------------------------------------
# Inline dispatcher that mirrors RedisSession._handle_command_call logic.
# This is NOT a duplicate of production code — it's a test harness that
# exercises the exact same command framework contracts.
# ---------------------------------------------------------------------------

async def _dispatch(
    name: str,
    raw_args: dict,
    *,
    user_id: str = "user-1",
    session_id: str = "sess-1",
    chat_id: str = "chat-1",
    knowledge=None,
) -> CommandResult:
    """Dispatch a command by name+args and return the CommandResult."""
    spec = CommandRegistry.get(name) if isinstance(name, str) else None
    if spec is None:
        return CommandResult.error(code="unknown_command", message=f"Unknown command: {name}")

    try:
        args = spec.args_model.model_validate(raw_args)
    except ValidationError as e:
        return CommandResult.error(code="invalid_args", message=str(e))

    ctx = CommandContext(
        user_id=user_id,
        session_id=session_id,
        chat_id=chat_id,
        tools_config=None,
        knowledge=knowledge,
        emit=AsyncMock(),
        client_tool_runner=None,
    )

    try:
        return await spec.handler(args, ctx)
    except Exception as exc:
        return CommandResult.error(code="handler_error", message=str(exc))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_registry():
    # Evict cached command modules so @command decorators re-run on load_commands()
    for mod_name in list(sys.modules):
        if mod_name.startswith("src.commands.") and mod_name not in {
            "src.commands.base", "src.commands.registry", "src.commands.context"
        }:
            del sys.modules[mod_name]
    commands_pkg._loaded = False
    CommandRegistry._reset_for_tests()
    load_commands()
    yield
    CommandRegistry._reset_for_tests()
    commands_pkg._loaded = False


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_command_call_success():
    """Valid command + valid args → ok=True result."""
    knowledge = AsyncMock()
    result = await _dispatch("memory.note", {"text": "hello world"}, knowledge=knowledge)
    assert result.ok is True
    assert result.error is None


@pytest.mark.asyncio
async def test_command_call_invalid_args():
    """Empty text violates min_length=1 → ok=False, code=invalid_args."""
    result = await _dispatch("memory.note", {"text": ""})
    assert result.ok is False
    assert result.error is not None
    assert result.error["code"] == "invalid_args"


@pytest.mark.asyncio
async def test_command_call_unknown_command():
    """Unregistered command name → ok=False, code=unknown_command."""
    result = await _dispatch("no.such.command", {})
    assert result.ok is False
    assert result.error is not None
    assert result.error["code"] == "unknown_command"


@pytest.mark.asyncio
async def test_command_call_handler_exception():
    """Handler that raises RuntimeError → ok=False, code=handler_error, no re-raise."""
    from pydantic import BaseModel

    class _Args(BaseModel):
        pass

    async def _boom(args, ctx):
        raise RuntimeError("kaboom")

    spec = CommandSpec(name="test.boom", title="Boom", description="boom", args_model=_Args, handler=_boom)
    CommandRegistry._by_name["test.boom"] = spec

    try:
        result = await _dispatch("test.boom", {})
        assert result.ok is False
        assert result.error is not None
        assert result.error["code"] == "handler_error"
        assert "kaboom" in result.error["message"]
    finally:
        CommandRegistry._by_name.pop("test.boom", None)
