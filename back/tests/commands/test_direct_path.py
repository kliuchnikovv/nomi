"""Tests for RedisSession._handle_command_call dispatch path (Task 5).

We call the REAL RedisSession._handle_command_call by:
  1. Stubbing problematic transitive imports via sys.modules BEFORE importing RedisSession
  2. Constructing a minimal instance via RedisSession.__new__(RedisSession)
  3. Replacing session._send_frame with an AsyncMock to capture emitted frames

Stub list (why each is needed):
  - httpx                  : imported at module level in redis_session.py
  - redis / redis.asyncio  : redis_client module-level import (needs package structure)
  - redis.exceptions       : ConnectionError alias used in redis_session.py
  - agno.*                 : agno.media, agno.memory.manager, agno.models.message — module-level
  - src.agents.factory     : AgentFactory — module-level import in redis_session.py
  - src.agents.nomi        : NomiAgent / build_learning_machine — module-level import
  - src.storage.backend    : PayloadBackend / StorageBackend — module-level import
  - src.storage.factory    : create_storage_backend — module-level import
  - src.workflows.models   : PlanStatus — module-level import
  - src.workflows.planning : build_planning_workflow etc — module-level import
"""
from __future__ import annotations

import sys
import types
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest


# ---------------------------------------------------------------------------
# Install stubs BEFORE importing anything from src.server
# ---------------------------------------------------------------------------

def _install_stubs() -> None:
    mm = MagicMock

    # redis needs a real package structure (not a plain MagicMock) so that
    # "import redis.asyncio as redis" and "from redis.exceptions import …" work.
    redis_mod = types.ModuleType("redis")
    redis_asyncio = mm()
    redis_exceptions = types.ModuleType("redis.exceptions")
    redis_exceptions.ConnectionError = ConnectionError  # type: ignore[attr-defined]
    redis_mod.asyncio = redis_asyncio  # type: ignore[attr-defined]
    redis_mod.exceptions = redis_exceptions  # type: ignore[attr-defined]
    sys.modules.setdefault("redis", redis_mod)
    sys.modules.setdefault("redis.asyncio", redis_asyncio)
    sys.modules.setdefault("redis.exceptions", redis_exceptions)

    for name in [
        "httpx",
        "agno",
        "agno.media",
        "agno.memory",
        "agno.memory.manager",
        "agno.models",
        "agno.models.message",
        "agno.db",
        "agno.db.postgres",
        "agno.db.postgres.async_postgres",
        "agno.db.postgres.schemas",
        "agno.vectordb",
        "agno.vectordb.pgvector",
        "agno.vectordb.pgvector.pgvector",
        "src.agents.factory",
        "src.agents.nomi",
        "src.storage.backend",
        "src.storage.factory",
        "src.workflows.models",
        "src.workflows.planning",
    ]:
        sys.modules.setdefault(name, mm())


_install_stubs()

# Now safe to import RedisSession and the command framework
from src.server.redis_session import RedisSession  # noqa: E402
from src.server.models import Frame, Kind, Op  # noqa: E402
import src.commands as commands_pkg  # noqa: E402
from src.commands import load_commands  # noqa: E402
from src.commands.registry import CommandRegistry  # noqa: E402
from src.commands.base import CommandSpec  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_frame(name: str, args: dict) -> Frame:
    return Frame(
        id=1,
        ts=datetime.now(timezone.utc),
        kind=Kind.DATA,
        op=Op.MESSAGE,
        chat_id="chat-1",
        payload={"name": name, "args": args},
    )


def _make_session(knowledge=None) -> RedisSession:
    """Build a minimal RedisSession without calling __init__."""
    session = RedisSession.__new__(RedisSession)
    session.user_id = "user-1"
    session.session_id = "sess-1"
    session.chat_id = "chat-1"
    session.tools_config_client = None
    session.knowledge = knowledge
    session.next_id = 0
    session._go_ws = None
    session.redis_client = None
    # Attributes initialised in __init__ that handle_frame's finally block touches
    session._result_listener_task = None
    session.pubsub = None
    # Replace _send_frame so no real Redis/WS calls occur
    session._send_frame = AsyncMock()
    return session


# ---------------------------------------------------------------------------
# Registry fixture — reload commands fresh for each test
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_registry():
    for mod_name in list(sys.modules):
        if mod_name.startswith("src.commands.") and mod_name not in {
            "src.commands.base",
            "src.commands.registry",
            "src.commands.context",
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
    """Valid command + valid args → _send_frame called with op=done, ok=True."""
    # memory.note calls knowledge.insert() synchronously
    knowledge = MagicMock()
    knowledge.insert = MagicMock(return_value=None)

    session = _make_session(knowledge=knowledge)
    frame = _make_frame("memory.note", {"text": "hello world"})

    await session._handle_command_call(frame)

    session._send_frame.assert_called_once()
    sent: Frame = session._send_frame.call_args[0][0]
    assert sent.op == Op.DONE
    assert sent.payload is not None
    cr = sent.payload["meta"]["command_result"]
    assert cr["ok"] is True
    assert cr["error"] is None


@pytest.mark.asyncio
async def test_command_call_invalid_args():
    """Empty text violates min_length=1 → op=done, ok=False, code=invalid_args."""
    session = _make_session()
    frame = _make_frame("memory.note", {"text": ""})

    await session._handle_command_call(frame)

    session._send_frame.assert_called_once()
    sent: Frame = session._send_frame.call_args[0][0]
    assert sent.op == Op.DONE
    cr = sent.payload["meta"]["command_result"]
    assert cr["ok"] is False
    assert cr["error"]["code"] == "invalid_args"


@pytest.mark.asyncio
async def test_command_call_unknown_command():
    """Unregistered command name → op=done, ok=False, code=unknown_command."""
    session = _make_session()
    frame = _make_frame("no.such.command", {})

    await session._handle_command_call(frame)

    session._send_frame.assert_called_once()
    sent: Frame = session._send_frame.call_args[0][0]
    assert sent.op == Op.DONE
    cr = sent.payload["meta"]["command_result"]
    assert cr["ok"] is False
    assert cr["error"]["code"] == "unknown_command"


@pytest.mark.asyncio
async def test_handle_frame_routes_command_call():
    """handle_frame(op=COMMAND_CALL) routes to _handle_command_call.

    We confirm routing by checking that _send_frame is called with a DONE frame
    that carries payload.meta.command_result — the signature of _emit_command_result.
    """
    knowledge = MagicMock()
    knowledge.insert = MagicMock(return_value=None)

    session = _make_session(knowledge=knowledge)

    frame = Frame(
        id=2,
        ts=datetime.now(timezone.utc),
        kind=Kind.DATA,
        op=Op.COMMAND_CALL,
        chat_id="chat-1",
        payload={"name": "memory.note", "args": {"text": "routed via handle_frame"}},
    )

    await session.handle_frame(frame)

    session._send_frame.assert_called_once()
    sent: Frame = session._send_frame.call_args[0][0]
    assert sent.op == Op.DONE
    assert "command_result" in sent.payload.get("meta", {})


@pytest.mark.asyncio
async def test_command_call_handler_exception():
    """Handler that raises RuntimeError → op=done, ok=False, code=handler_error, no re-raise."""
    from pydantic import BaseModel

    class _Args(BaseModel):
        pass

    async def _boom(args, ctx):
        raise RuntimeError("kaboom")

    spec = CommandSpec(
        name="test.boom",
        title="Boom",
        description="boom",
        args_model=_Args,
        handler=_boom,
    )
    CommandRegistry._by_name["test.boom"] = spec

    try:
        session = _make_session()
        frame = _make_frame("test.boom", {})

        await session._handle_command_call(frame)

        session._send_frame.assert_called_once()
        sent: Frame = session._send_frame.call_args[0][0]
        assert sent.op == Op.DONE
        cr = sent.payload["meta"]["command_result"]
        assert cr["ok"] is False
        assert cr["error"]["code"] == "handler_error"
        assert "kaboom" in cr["error"]["message"]
    finally:
        CommandRegistry._by_name.pop("test.boom", None)
