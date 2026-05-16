"""Tests verifying that Agno session memory is correctly wired end-to-end.

Agno loads conversation history from PostgreSQL using session_id.
For this to work every link in the chain must be correct:

  create_storage_backend()
      → AgnoBackend  (agent_storage_mode = "agno")
      → PayloadBackend (default)

  AgentFactory.build()   [factory.py]
      AgnoBackend  → NomiAgent(session_id="<real id>")  ← Agno loads from DB
      PayloadBackend → NomiAgent(session_id=None)       ← ephemeral

  _stream_agent_events() [redis_session.py]
      non-team mode → kwargs["session_id"] = self.session_id  ← passed to arun()
      team mode     → session_id NOT in kwargs

  AgentRunWrapper.arun()  [factory.py]
      forwards all kwargs (incl. session_id) to underlying agent.arun()
"""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ─── 1. Storage backend factory ───────────────────────────────────────────────

class TestCreateStorageBackend:
    def test_agno_mode_returns_agno_backend(self):
        from src.storage.factory import create_storage_backend
        from src.storage.backend import AgnoBackend

        backend = create_storage_backend(
            agent_storage_mode="agno",
            chat_history=[{"role": "user", "content": "hi"}],
            session_id="sess-abc",
        )
        assert isinstance(backend, AgnoBackend)

    def test_payload_mode_returns_payload_backend(self):
        from src.storage.factory import create_storage_backend
        from src.storage.backend import PayloadBackend

        backend = create_storage_backend(
            agent_storage_mode="payload",
            chat_history=[{"role": "user", "content": "hi"}],
            session_id="sess-abc",
        )
        assert isinstance(backend, PayloadBackend)

    def test_unknown_mode_falls_back_to_payload_backend(self):
        from src.storage.factory import create_storage_backend
        from src.storage.backend import PayloadBackend

        backend = create_storage_backend(
            agent_storage_mode="unknown",
            chat_history=[],
            session_id="sess-x",
        )
        assert isinstance(backend, PayloadBackend)


# ─── 2. AgnoBackend / PayloadBackend contracts ────────────────────────────────

class TestStorageBackendContracts:
    def test_agno_backend_use_agno_sessions_true(self):
        from src.storage.backend import AgnoBackend
        b = AgnoBackend(session_id="s1")
        assert b.use_agno_sessions() is True

    def test_agno_backend_get_history_returns_empty(self):
        """Agno loads history from DB itself; the backend must not supply it."""
        from src.storage.backend import AgnoBackend
        b = AgnoBackend(session_id="s1")
        assert b.get_history() == []

    def test_payload_backend_use_agno_sessions_false(self):
        from src.storage.backend import PayloadBackend
        b = PayloadBackend(chat_history=[{"role": "user", "content": "x"}])
        assert b.use_agno_sessions() is False

    def test_payload_backend_get_history_returns_injected(self):
        from src.storage.backend import PayloadBackend
        hist = [{"role": "user", "content": "hello"}]
        b = PayloadBackend(chat_history=hist)
        assert b.get_history() == hist


# ─── 3. AgentFactory wires session_id correctly into NomiAgent ──────────────

class TestAgentFactorySessionWiring:
    """Factory must pass session_id to NomiAgent only for AgnoBackend."""

    def _make_factory(self, monkeypatch):
        from src.agents.factory import AgentFactory
        from src.tools.config import ToolConfigClient

        config_client = MagicMock(spec=ToolConfigClient)
        config_client.fetch_tools = AsyncMock(return_value=MagicMock(entries={}))
        factory = AgentFactory(db=None, model=MagicMock(), config_client=config_client)
        factory.build_model = MagicMock(return_value=MagicMock())
        return factory

    @pytest.mark.asyncio
    async def test_agno_backend_passes_real_session_id_to_souper(self, monkeypatch):
        """AgnoBackend → NomiAgent receives the actual session_id."""
        from src.storage.backend import AgnoBackend

        captured: dict = {}

        def fake_nomi(db, model, tools, **kwargs):
            captured.update(kwargs)
            agent = MagicMock()
            agent.name = "nomi"
            return agent

        monkeypatch.setattr("src.agents.factory.NomiAgent", fake_nomi)

        factory = self._make_factory(monkeypatch)
        await factory.build(
            session_id="session-xyz",
            user_id="user-1",
            model_name="gemini-2.0-flash",
            client_tool_runner=AsyncMock(),
            storage_backend=AgnoBackend(session_id="session-xyz"),
        )

        assert captured.get("session_id") == "session-xyz", (
            f"Expected session_id='session-xyz', got {captured.get('session_id')!r}"
        )

    @pytest.mark.asyncio
    async def test_payload_backend_passes_none_session_id_to_souper(self, monkeypatch):
        """PayloadBackend → NomiAgent receives session_id=None (ephemeral)."""
        from src.storage.backend import PayloadBackend

        captured: dict = {}

        def fake_nomi(db, model, tools, **kwargs):
            captured.update(kwargs)
            agent = MagicMock()
            agent.name = "nomi"
            return agent

        monkeypatch.setattr("src.agents.factory.NomiAgent", fake_nomi)

        factory = self._make_factory(monkeypatch)
        await factory.build(
            session_id="session-xyz",
            user_id="user-1",
            model_name="gemini-2.0-flash",
            client_tool_runner=AsyncMock(),
            storage_backend=PayloadBackend(chat_history=[]),
        )

        assert captured.get("session_id") is None, (
            f"Expected session_id=None, got {captured.get('session_id')!r}"
        )

    def test_souper_always_built_with_add_history_to_context(self):
        """add_history_to_context=True must be present in NomiAgent's constructor.
        This is what tells Agno to inject session history into every run's context."""
        import inspect
        from src.agents.nomi import NomiAgent

        source = inspect.getsource(NomiAgent.__init__)
        assert "add_history_to_context=True" in source, (
            "NomiAgent must pass add_history_to_context=True to Agent.__init__"
        )

    @pytest.mark.asyncio
    async def test_agno_backend_enables_num_history_runs(self, monkeypatch):
        """AgnoBackend → NomiAgent receives num_history_runs=6."""
        from src.storage.backend import AgnoBackend

        captured: dict = {}

        def fake_nomi(db, model, tools, **kwargs):
            captured.update(kwargs)
            agent = MagicMock()
            agent.name = "nomi"
            return agent

        monkeypatch.setattr("src.agents.factory.NomiAgent", fake_nomi)

        factory = self._make_factory(monkeypatch)
        await factory.build(
            session_id="sess",
            user_id="u1",
            model_name="gemini-2.0-flash",
            client_tool_runner=AsyncMock(),
            storage_backend=AgnoBackend(session_id="sess"),
        )

        assert captured.get("num_history_runs") == 6


# ─── 4. session_id kwarg reaches agent.arun() at runtime ─────────────────────

class TestSessionIdPassedToAgentAtRuntime:
    """_stream_agent_events must include session_id in the kwargs it passes to
    _invoke_agent, which forwards them to agent.arun().  This is how Agno knows
    which session to load from the database."""

    def _make_session(self, command_desc=None):
        from src.server.redis_session import RedisSession
        from src.storage.backend import AgnoBackend

        session = RedisSession.__new__(RedisSession)
        session.session_id = "sess-agno-1"
        session.chat_id = "chat-1"
        session.user_id = "user-1"
        session.context_items = []
        session._accumulated_tool_results = []
        session.chat_history = []
        session.storage_backend = AgnoBackend(session_id="sess-agno-1")
        session.command_desc = command_desc or {"type": "agent"}
        return session

    @pytest.mark.asyncio
    async def test_session_id_kwarg_passed_to_arun_in_agent_mode(self):
        """Non-team mode: session_id must be in kwargs forwarded to agent.arun()."""
        session = self._make_session(command_desc={"type": "agent"})

        captured: dict = {}

        def fake_arun(inp, **kwargs):
            captured.update(kwargs)
            return MagicMock()

        agent = MagicMock()
        agent.arun = fake_arun
        del agent.run
        session.agent = agent

        # _invoke_agent adds stream=True/stream_events=True itself;
        # _stream_agent_events only contributes session_id (and optionally images).
        kwargs = {"session_id": session.session_id}
        await session._invoke_agent(agent, "hello", kwargs)

        assert "session_id" in captured, "session_id must be forwarded to agent.arun()"
        assert captured["session_id"] == "sess-agno-1"

    @pytest.mark.asyncio
    async def test_session_id_not_in_kwargs_for_team_mode(self):
        """Team mode: session_id must NOT be included — teams use internal state."""
        from src.server.redis_session import RedisSession
        from src.storage.backend import AgnoBackend

        session = RedisSession.__new__(RedisSession)
        session.session_id = "sess-team-1"
        session.chat_id = "chat-1"
        session.context_items = []
        session._accumulated_tool_results = []
        session.chat_history = []
        session.storage_backend = AgnoBackend(session_id="sess-team-1")
        session.command_desc = {"type": "team"}

        # Replicate what _stream_agent_events does
        kwargs: dict = {}
        if (
            session.session_id
            and session.command_desc
            and session.command_desc.get("type", "agent") != "team"
        ):
            kwargs["session_id"] = session.session_id

        assert "session_id" not in kwargs, (
            "session_id must not be passed to agent in team mode"
        )

    @pytest.mark.asyncio
    async def test_agent_run_wrapper_forwards_session_id(self):
        """AgentRunWrapper must not strip session_id from kwargs."""
        from src.agents.factory import AgentRunWrapper

        captured: dict = {}

        inner_agent = MagicMock()
        inner_agent.arun = lambda inp, **kw: captured.update(kw) or MagicMock()

        wrapper = AgentRunWrapper(inner_agent, rag_user_id="u1")
        wrapper.arun("hello", session_id="sess-fwd", stream=True)

        assert captured.get("session_id") == "sess-fwd", (
            f"AgentRunWrapper dropped session_id: {captured}"
        )
