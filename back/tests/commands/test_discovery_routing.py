"""Tests for command routing via discovery_tool (Task 6).

We verify:
 1. When ToolRouter.decide returns an 'execute' decision targeting 'memory.note',
    the discovery tool dispatches to _execute_command and returns a JSON result.
 2. The discovery_tool description includes command titles (e.g. "Save note to memory").

Uses the same sys.modules stub pattern as test_direct_path.py to avoid
importing heavy transitive dependencies (agno, redis, httpx, etc.).
"""
from __future__ import annotations

import json
import sys
import types
from unittest.mock import AsyncMock, MagicMock

import pytest


# ---------------------------------------------------------------------------
# Install stubs BEFORE importing anything from src.tools.discovery
# ---------------------------------------------------------------------------

def _install_stubs() -> None:
    mm = MagicMock

    # agno.tools needs a real module so `from agno.tools import Function, Toolkit` works
    agno_mod = types.ModuleType("agno")
    agno_tools_mod = types.ModuleType("agno.tools")

    class _FakeFunction:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)
            # Store the entrypoint callable under a private name so we can call it
            self._entrypoint_fn = kwargs.get("entrypoint")

        async def entrypoint(self, **kwargs):
            return await self._entrypoint_fn(**kwargs)

    class _FakeToolkit:
        name: str = "fake"
        functions: dict = {}
        async_functions: dict = {}

    agno_tools_mod.Function = _FakeFunction  # type: ignore[attr-defined]
    agno_tools_mod.Toolkit = _FakeToolkit  # type: ignore[attr-defined]
    agno_mod.tools = agno_tools_mod  # type: ignore[attr-defined]

    sys.modules.setdefault("agno", agno_mod)
    sys.modules.setdefault("agno.tools", agno_tools_mod)

    for name in [
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
    ]:
        sys.modules.setdefault(name, mm())

    # src.plugins.loader is called by _build_discovery_description
    plugins_loader = types.ModuleType("src.plugins.loader")
    plugins_loader.load_plugins = MagicMock()  # type: ignore[attr-defined]
    plugins_loader.get_manifests = MagicMock(return_value=[])  # type: ignore[attr-defined]
    sys.modules.setdefault("src.plugins", types.ModuleType("src.plugins"))
    sys.modules.setdefault("src.plugins.loader", plugins_loader)

    # src.tools.{config,registry,router,executor} are imported at module level
    for name in [
        "src.tools.config",
        "src.tools.registry",
        "src.tools.router",
        "src.tools.executor",
    ]:
        sys.modules.setdefault(name, mm())

    # Provide a real ToolRegistry.build stub
    registry_mod = sys.modules["src.tools.registry"]
    registry_mod.ToolRegistry = MagicMock()  # type: ignore[attr-defined]
    registry_mod.ToolRegistry.build = MagicMock(return_value=[])  # type: ignore[attr-defined]


_install_stubs()

# Now safe to import
import src.commands as commands_pkg  # noqa: E402
from src.commands import load_commands  # noqa: E402
from src.commands.registry import CommandRegistry  # noqa: E402
from src.tools.discovery import build_discovery_tool  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _load():
    """Reset and reload commands fresh for each test."""
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


def _stub_router(decision):
    router = MagicMock()
    router.decide = MagicMock(return_value=decision)
    return router


def _stub_config_client():
    client = MagicMock()
    client.fetch_tools = AsyncMock(return_value=MagicMock(entries={}))
    return client


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_discovery_routes_to_command():
    """discovery_tool dispatches to _execute_command when router returns memory.note."""

    class Decision:
        action = "execute"
        tool = "memory.note"
        method = "invoke"
        params = {"text": "hello", "tags": ["t"]}
        account_id = ""

    # Mock knowledge object for command context
    mock_knowledge = MagicMock()

    fn = build_discovery_tool(
        user_id="u1",
        config_client=_stub_config_client(),
        router=_stub_router(Decision()),
        executor=MagicMock(),
        knowledge=mock_knowledge,
    )

    # Ensure memory.note is registered
    spec = CommandRegistry.get("memory.note")
    assert spec is not None, "memory.note command must be registered"

    raw = await fn.entrypoint(request="remember vegan", context="")
    parsed = json.loads(raw)
    # With knowledge properly wired, the command should execute successfully
    assert parsed["type"] == "result", f"Expected result, got {parsed.get('type')}: {parsed.get('message', '')}"
    assert parsed["tool"] == "memory.note"


@pytest.mark.asyncio
async def test_discovery_description_lists_commands():
    """discovery_tool description includes command titles after load_commands()."""
    fn = build_discovery_tool(
        user_id="u1",
        config_client=_stub_config_client(),
        router=_stub_router(MagicMock(action="none")),
        executor=MagicMock(),
    )
    assert "Save note to memory" in fn.description
