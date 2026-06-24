"""Tests for GET /commands endpoint (Task 7).

Verifies the endpoint returns a per-user command listing with `missing` field
computed from connected integrations.
"""
from __future__ import annotations

import json
import os
import sys
import types
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Set minimal env vars before any imports
os.environ.setdefault("GEMINI_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("ENCRYPTION_KEY", "test-key-32-bytes-long-12345")
os.environ.setdefault("JWT_SECRET", "test-secret")


# ---------------------------------------------------------------------------
# Install stubs BEFORE importing app or src modules
# ---------------------------------------------------------------------------

def _install_stubs() -> None:
    """Stub heavy imports to avoid loading agno, redis, etc."""
    mm = MagicMock

    # Stub redis with proper package structure
    redis_mod = types.ModuleType("redis")
    redis_asyncio = mm()
    redis_exceptions = types.ModuleType("redis.exceptions")
    redis_exceptions.ConnectionError = ConnectionError  # type: ignore[attr-defined]
    redis_mod.asyncio = redis_asyncio  # type: ignore[attr-defined]
    redis_mod.exceptions = redis_exceptions  # type: ignore[attr-defined]
    sys.modules.setdefault("redis", redis_mod)
    sys.modules.setdefault("redis.asyncio", redis_asyncio)
    sys.modules.setdefault("redis.exceptions", redis_exceptions)

    # Stub agno and all its submodules
    agno_mod = types.ModuleType("agno")

    class _FakeAgentOS:
        def __init__(self, agents=None):
            self.agents = agents or []

        def get_app(self):
            from fastapi import FastAPI
            return FastAPI()

    agno_os_mod = types.ModuleType("agno.os")
    agno_os_mod.AgentOS = _FakeAgentOS  # type: ignore[attr-defined]

    agno_models_mod = types.ModuleType("agno.models")
    agno_models_mod.Message = mm()  # type: ignore[attr-defined]

    # Stub knowledge, embedder, and related modules
    for name in [
        "agno",
        "agno.os",
        "agno.models",
        "agno.models.message",
        "agno.knowledge",
        "agno.knowledge.embedder",
        "agno.knowledge.embedder.google",
        "agno.media",
        "agno.memory",
        "agno.memory.manager",
        "agno.db",
        "agno.db.postgres",
        "agno.db.postgres.async_postgres",
        "agno.db.postgres.schemas",
        "agno.vectordb",
        "agno.vectordb.pgvector",
        "agno.vectordb.pgvector.pgvector",
        "agno.tools",
    ]:
        if name not in sys.modules:
            sys.modules[name] = mm()

    # Override with actual implementations where needed
    sys.modules["agno"] = agno_mod
    sys.modules["agno.os"] = agno_os_mod
    sys.modules["agno.models"] = agno_models_mod
    agno_mod.os = agno_os_mod  # type: ignore[attr-defined]
    agno_mod.models = agno_models_mod  # type: ignore[attr-defined]

    # Stub other heavy modules
    for name in [
        "httpx",
        "src.agents.factory",
        "src.agents.nomi",
        "src.storage.backend",
        "src.storage.factory",
        "src.workflows.models",
        "src.workflows.planning",
        "src.server.redis_worker",
        "src.proactive.judge_worker",
        "src.core.container",
        "src.core.config",
        "src.core.gemini_keys",
    ]:
        sys.modules.setdefault(name, mm())


_install_stubs()

# Now safe to import app and src modules
import app as app_module
from src.commands import load_commands


@pytest.fixture(autouse=True)
def _load():
    """Load all commands before tests."""
    load_commands()


def test_get_commands_returns_listing():
    """Test GET /commands returns properly formatted command listing."""
    client = TestClient(app_module.app)

    # Stub ToolConfigClient instance to return no connected integrations.
    class _FakeCfg:
        entries = {}

    async def _fake_fetch(user_id=None, session_id=None):
        return _FakeCfg()

    # Patch the module-level singleton instance
    with patch.object(app_module._tool_config_client, "fetch_tools", new_callable=AsyncMock, side_effect=_fake_fetch):
        resp = client.get("/commands", headers={"X-User-ID": "user-1"})

    assert resp.status_code == 200
    body = resp.json()
    assert "commands" in body
    names = [c["name"] for c in body["commands"]]
    assert "memory.note" in names
    note = next(c for c in body["commands"] if c["name"] == "memory.note")
    assert note["missing"] == []
    assert "args_schema" in note


def test_get_commands_with_connected_integrations():
    """Test GET /commands computes missing field based on connected integrations."""
    client = TestClient(app_module.app)

    # Mock a config with gmail connected
    class _FakeCfg:
        entries = {"gmail": {}}

    async def _fake_fetch(user_id=None, session_id=None):
        return _FakeCfg()

    # Patch the module-level singleton instance
    with patch.object(app_module._tool_config_client, "fetch_tools", new_callable=AsyncMock, side_effect=_fake_fetch):
        resp = client.get("/commands", headers={"X-User-ID": "user-2"})

    assert resp.status_code == 200
    body = resp.json()
    assert "commands" in body
    # Check that commands with missing integrations show them
    note = next(c for c in body["commands"] if c["name"] == "memory.note")
    assert isinstance(note["missing"], list)


def test_get_commands_includes_slash_commands():
    """Slash commands (e.g. /help, /think) are merged into the same listing."""
    client = TestClient(app_module.app)

    class _FakeCfg:
        entries = {}

    async def _fake_fetch(user_id=None, session_id=None):
        return _FakeCfg()

    with patch.object(app_module._tool_config_client, "fetch_tools", new_callable=AsyncMock, side_effect=_fake_fetch):
        resp = client.get("/commands", headers={"X-User-ID": "user-3"})

    assert resp.status_code == 200
    names = {c["name"] for c in resp.json()["commands"]}
    for expected in {"help", "status", "think", "usage", "reset", "compact", "forget"}:
        assert expected in names, f"missing slash command: /{expected}"
    help_spec = next(c for c in resp.json()["commands"] if c["name"] == "help")
    assert help_spec["surface"] == "chat"
    assert help_spec["requires"] == []
    assert help_spec["missing"] == []
    assert help_spec["kind"] == "slash"
    # Existing agent commands stay kind=agent so the client routes them via
    # op=command_call.
    agent_spec = next(c for c in resp.json()["commands"] if c["name"] == "memory.note")
    assert agent_spec["kind"] == "agent"


def test_get_commands_missing_user_id():
    """Test GET /commands returns 422 when X-User-Id header is missing."""
    client = TestClient(app_module.app)

    # Try without the header
    resp = client.get("/commands")

    # Should return 422 (validation error)
    assert resp.status_code == 422
