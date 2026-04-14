"""Conftest that mocks all heavy dependencies before any test module is collected.

Strategy: mock agno/* and src.agents/* (heavy external deps with deep chains),
but let src.server.* (our own code) load naturally since it's what we're testing.
"""

import sys
import types
from unittest.mock import MagicMock


def _install_mock_module(name, attrs=None):
    """Register a mock module in sys.modules, optionally setting attributes."""
    if name not in sys.modules:
        mod = types.ModuleType(name)
        if attrs:
            for k, v in attrs.items():
                setattr(mod, k, v)
        sys.modules[name] = mod
    return sys.modules[name]


def _setup_all_mocks():
    # ── agno ecosystem (heavy external deps) ──
    _install_mock_module("agno")
    _install_mock_module("agno.agent", {"Agent": MagicMock})
    _install_mock_module("agno.media", {"Image": MagicMock})
    _install_mock_module("agno.workflow", {"Workflow": MagicMock})
    _install_mock_module("agno.workflow.types", {"WorkflowExecutionInput": MagicMock, "StepOutput": MagicMock})
    _install_mock_module("agno.db")
    _install_mock_module("agno.db.postgres", {"PostgresDb": MagicMock})
    _install_mock_module("agno.db.postgres.schemas")
    _install_mock_module("agno.db.postgres.async_postgres")
    _install_mock_module("agno.knowledge", {"Knowledge": MagicMock})
    _install_mock_module("agno.models", {"__path__": []})
    _install_mock_module("agno.models.base", {"Model": MagicMock})
    _install_mock_module("agno.models.message", {"Message": MagicMock})
    _install_mock_module("agno.vectordb")
    _install_mock_module("agno.vectordb.pgvector", {"PgVector": MagicMock})
    _install_mock_module("agno.tools", {"Toolkit": MagicMock, "Function": MagicMock})
    _install_mock_module("agno.utils")
    _install_mock_module("agno.utils.log", {"logger": MagicMock()})

    # ── sqlalchemy (required by agno.db.postgres) ──
    _install_mock_module("sqlalchemy")
    _install_mock_module("sqlalchemy.dialects")
    _install_mock_module("sqlalchemy.dialects.postgresql")
    _install_mock_module("sqlalchemy.types")

    # ── src.agents (depends on agno) ──
    _install_mock_module("src.agents")
    _install_mock_module("src.agents.factory", {
        "AgentFactory": MagicMock,
        "AgentRunWrapper": MagicMock,
    })
    _install_mock_module("src.agents.souper", {"SouperAgent": MagicMock})
    _install_mock_module("src.agents.planner", {
        "build_planner_agent": MagicMock,
        "PLANNER_INSTRUCTIONS": "",
    })

    # ── src.models (depends on agno) ──
    _install_mock_module("src.models", {"__path__": []})
    _install_mock_module("src.models.safe_gemini", {"SafeGemini": MagicMock})
    _install_mock_module("src.models.safe_openai", {"SafeOpenAI": MagicMock})

    # ── src.tools (depends on agno) ──
    # Mock only the heavy-dep modules used as dependencies.
    # Modules that are tested directly (executor, planning, registry, router,
    # user_interaction, discovery) load from disk — they only need agno.tools
    # and agno.utils.log which are mocked above.
    _install_mock_module("src.tools", {"__path__": []})
    _install_mock_module("src.tools.config", {"ToolConfigClient": MagicMock})
    _install_mock_module("src.tools.factory", {"build": MagicMock, "ToolsConfig": MagicMock, "TOOL_BUILDERS": {}})
    _install_mock_module("src.tools.models", {"ToolSpec": MagicMock})

    # ── src.workflows ──
    # Do NOT mock src.workflows, src.workflows.models, src.workflows.planning,
    # src.workflows.tools, or src.workflows.ors_client — their __init__.py is
    # empty/clean, models/tools/ors_client have no agno deps, and planning.py
    # only needs agno.workflow.Workflow which is mocked above.
    # Empty mocks for files that don't exist on disk (prevent ImportError):
    _install_mock_module("src.workflows.clarification")
    _install_mock_module("src.workflows.stages")

    # ── src.server.delivery (depends on agno) ──
    _install_mock_module("src.server.delivery", {
        "deliver_response": MagicMock,
        "deliver_error": MagicMock,
    })


_setup_all_mocks()
