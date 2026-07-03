"""Conftest that mocks all heavy dependencies before any test module is collected.

Strategy: mock agno/* and src.agents/* (heavy external deps with deep chains),
but let src.server.* (our own code) load naturally since it's what we're testing.
"""

import os
import sys
import types
from unittest.mock import MagicMock

# Absolute path to back/src/ so partial-mock packages can find real submodules on disk
_SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "src")
_SRC_DIR = os.path.normpath(_SRC_DIR)


class _StubToolkit:
    """Minimal stand-in for agno.tools.Toolkit that allows normal class inheritance."""
    def __init__(self, name: str = "", **kwargs):
        self.name = name
        self._tools: dict = {}

    def register(self, func, name: str = "", description: str = "", **kwargs):
        self._tools[name or func.__name__] = func
        return func


class _StubFunction:
    """Minimal stand-in for agno.tools.Function."""
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


class _StubWorkflow:
    """Minimal stand-in for agno.workflow.Workflow that stores session_state as real dict."""
    def __init__(self, session_state=None, **kwargs):
        self.session_state = session_state if session_state is not None else {}
        for k, v in kwargs.items():
            setattr(self, k, v)


class _StubWorkflowInput:
    """Minimal stand-in for agno.workflow.types.WorkflowExecutionInput."""
    def __init__(self, input=None, additional_data=None, **kwargs):
        self.input = input
        self.additional_data = additional_data or {}
        for k, v in kwargs.items():
            setattr(self, k, v)


class _StubStepOutput:
    """Minimal stand-in for agno.workflow.types.StepOutput."""
    def __init__(self, step_name="", content="", **kwargs):
        self.step_name = step_name
        self.content = content
        for k, v in kwargs.items():
            setattr(self, k, v)


class _StubAgent:
    """Minimal stand-in for agno.agent.Agent that stores __init__ kwargs as attributes."""
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)

    def run(self, *args, **kwargs):
        return MagicMock()

    async def arun(self, *args, **kwargs):
        return MagicMock()


class _StubModel:
    """Minimal stand-in for agno model base classes (OpenAIChat, Gemini, etc.)."""
    def __init__(self, *args, **kwargs):
        pass

    def invoke(self, messages, *args, **kwargs):
        pass

    async def ainvoke(self, messages, *args, **kwargs):
        pass

    def invoke_stream(self, messages, *args, **kwargs):
        return iter([])

    async def ainvoke_stream(self, messages, *args, **kwargs):
        return
        yield  # make it an async generator

    def _format_tools(self, tools):
        return tools or []

    def get_request_params(self, *args, **kwargs):
        return {}


class _StubMessage:
    """Minimal stand-in for agno.models.message.Message."""
    def __init__(self, role: str = "", content: str = "", **kwargs):
        self.role = role
        self.content = content
        self.tool_calls = kwargs.pop("tool_calls", None)
        self.tool_call_id = kwargs.pop("tool_call_id", None)
        for k, v in kwargs.items():
            setattr(self, k, v)


class _StubModelResponse:
    """Minimal stand-in for agno.models.response.ModelResponse."""
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


def _install_mock_module(name, attrs=None):
    """Register a mock module in sys.modules, optionally setting attributes.

    Also wires the module as an attribute on its parent so that monkeypatch
    dotted-path resolution (e.g. "src.tools.factory.TOOL_BUILDERS") works.
    """
    if name not in sys.modules:
        mod = types.ModuleType(name)
        if attrs:
            for k, v in attrs.items():
                setattr(mod, k, v)
        sys.modules[name] = mod
        # Wire as attribute on parent (mirrors what the real importer does)
        if "." in name:
            parent_name, child_name = name.rsplit(".", 1)
            parent = sys.modules.get(parent_name)
            if parent is not None:
                setattr(parent, child_name, sys.modules[name])
    return sys.modules[name]


def _setup_all_mocks():
    # ── agno ecosystem (heavy external deps) ──
    _install_mock_module("agno")
    _install_mock_module("agno.agent", {"Agent": _StubAgent})
    _install_mock_module("agno.media", {"Image": MagicMock})
    _install_mock_module("agno.workflow", {"Workflow": _StubWorkflow})
    _install_mock_module("agno.workflow.types", {"WorkflowExecutionInput": _StubWorkflowInput, "StepOutput": _StubStepOutput})
    _install_mock_module("agno.db")
    _install_mock_module("agno.db.postgres", {"PostgresDb": MagicMock})
    _install_mock_module("agno.db.postgres.schemas")
    _install_mock_module("agno.db.postgres.async_postgres")
    _install_mock_module("agno.knowledge", {"Knowledge": MagicMock})
    _install_mock_module("agno.knowledge.document", {"Document": MagicMock})
    _install_mock_module("agno.knowledge.embedder")
    _install_mock_module("agno.knowledge.embedder.google", {"GeminiEmbedder": MagicMock})
    _install_mock_module("agno.models", {"__path__": []})
    _install_mock_module("agno.models.base", {"Model": _StubModel})
    _install_mock_module("agno.models.message", {"Message": _StubMessage})
    _install_mock_module("agno.models.response", {"ModelResponse": _StubModelResponse})
    _install_mock_module("agno.models.openai", {"OpenAIChat": _StubModel})
    _install_mock_module("agno.models.google", {"Gemini": _StubModel})
    _install_mock_module("agno.vectordb")
    _install_mock_module("agno.vectordb.pgvector", {"PgVector": MagicMock})
    _install_mock_module("agno.tools", {"Toolkit": _StubToolkit, "Function": _StubFunction})
    _install_mock_module("agno.memory")
    _install_mock_module("agno.memory.manager", {"MemoryManager": MagicMock})
    _install_mock_module("agno.learn", {
        "EntityMemoryConfig": MagicMock,
        "LearnedKnowledgeConfig": MagicMock,
        "LearningMachine": MagicMock,
        "LearningMode": MagicMock,
        "SessionContextConfig": MagicMock,
        "UserProfileConfig": MagicMock,
    })
    _install_mock_module("agno.db.schemas")
    _install_mock_module("agno.db.schemas.memory", {"UserMemory": MagicMock})
    _install_mock_module("agno.session")
    _install_mock_module("agno.session.summary", {"SessionSummaryManager": MagicMock})
    _install_mock_module("agno.utils")
    _install_mock_module("agno.utils.log", {"logger": MagicMock()})

    # ── sqlalchemy (required by agno.db.postgres) ──
    _install_mock_module("sqlalchemy")
    _install_mock_module("sqlalchemy.dialects")
    _install_mock_module("sqlalchemy.dialects.postgresql")
    _install_mock_module("sqlalchemy.types")

    # ── src.agents (depends on agno) ──
    _install_mock_module("src.agents", {"__path__": [os.path.join(_SRC_DIR, "agents")]})
    # src.agents.factory, src.agents.planner, and src.agents.nomi are NOT mocked — tests test the real modules.
    # agno.memory, agno.learn, and agno.db.schemas stubs above enable nomi.py to load from disk.

    # ── src.models (depends on agno) ──
    # Do NOT mock safe_gemini or safe_openai — tests test those real classes.
    # They only need agno.models.* stubs (added above) to load from disk.
    _install_mock_module("src.models", {"__path__": [os.path.join(_SRC_DIR, "models")]})

    # ── src.tools (depends on agno) ──
    # Mock only the heavy-dep modules used as dependencies.
    # Modules that are tested directly load from disk via __path__ on the package mock.
    _install_mock_module("src.tools", {"__path__": [os.path.join(_SRC_DIR, "tools")]})
    _install_mock_module("src.tools.config", {"ToolConfigClient": MagicMock})
    # src.tools.factory is NOT mocked — tests need the real ToolsConfig, ToolItem, etc.
    # It only needs agno.tools.Toolkit (_StubToolkit) and google.oauth2.credentials (real).
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

# Wire mocked sub-packages onto their real parent modules so that monkeypatch
# dotted-path resolution works (e.g. "src.tools.factory.TOOL_BUILDERS").
# The real src/__init__.py is empty, so importing it is safe.
import src as _src_mod  # noqa: E402
_src_mod.tools = sys.modules["src.tools"]
if "src.tools.factory" in sys.modules:
    _src_mod.tools.factory = sys.modules["src.tools.factory"]
_src_mod.agents = sys.modules["src.agents"]
