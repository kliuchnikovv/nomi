"""Tests for single chat mode: context archiving and history search tool."""

import json
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, mock_open, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_session(*, single_chat_mode=True, chat_id="chat-1", user_id="user-1"):
    """Return a minimal RedisSession-like object with only the fields the methods under
    test actually read, without importing the full class (which needs redis, agno, etc.)."""
    from src.server.redis_session import RedisSession  # noqa: PLC0415

    session = object.__new__(RedisSession)
    session.single_chat_mode = single_chat_mode
    session.chat_id = chat_id
    session.user_id = user_id
    session.current_model_name = "glm-4-flash"
    session._model_context_limit = None
    session.chat_history = []
    session.agent_factory = MagicMock()
    session.agent_factory._knowledge = None
    return session


def _msg(idx: int, content: str = None, *, role: str = "user") -> dict:
    return {
        "id": f"msg-{idx}",
        "role": role,
        "content": content or ("x" * 100),
        "timestamp": f"2024-01-01T00:0{idx}:00Z",
    }


# ---------------------------------------------------------------------------
# _get_model_context_limit
# ---------------------------------------------------------------------------

class TestGetModelContextLimit:
    def test_returns_value_from_models_json(self):
        config_data = json.dumps({
            "models": [{"id": "glm-4-flash", "context_window": 32_000}]
        })
        session = _make_session()
        with patch("builtins.open", mock_open(read_data=config_data)):
            limit = session._get_model_context_limit("glm-4-flash")

        assert limit == 32_000

    def test_caches_result(self):
        session = _make_session()
        session._model_context_limit = 50_000
        # Should return cached value without touching disk
        limit = session._get_model_context_limit("any-model")
        assert limit == 50_000

    def test_falls_back_to_128k_on_missing_file(self):
        session = _make_session()
        with patch("builtins.open", side_effect=FileNotFoundError):
            limit = session._get_model_context_limit("unknown-model")
        assert limit == 128_000
        assert session._model_context_limit == 128_000

    def test_falls_back_to_128k_when_model_not_in_config(self):
        config_data = json.dumps({"models": [{"id": "other-model", "context_window": 8_000}]})
        session = _make_session()
        with patch("builtins.open", mock_open(read_data=config_data)):
            limit = session._get_model_context_limit("glm-4-flash")
        assert limit == 128_000


# ---------------------------------------------------------------------------
# _maybe_archive_old_messages — skipping conditions
# ---------------------------------------------------------------------------

class TestMaybeArchiveSkips:
    @pytest.mark.asyncio
    async def test_skips_when_single_chat_mode_off(self):
        session = _make_session(single_chat_mode=False)
        session.chat_history = [_msg(i) for i in range(10)]
        session._get_model_context_limit = MagicMock(return_value=100)

        await session._maybe_archive_old_messages()

        session._get_model_context_limit.assert_not_called()
        assert len(session.chat_history) == 10

    @pytest.mark.asyncio
    async def test_skips_when_no_model_name(self):
        session = _make_session()
        session.current_model_name = None
        session.chat_history = [_msg(i) for i in range(5)]

        await session._maybe_archive_old_messages()

        assert len(session.chat_history) == 5

    @pytest.mark.asyncio
    async def test_skips_when_history_empty(self):
        session = _make_session()
        session.chat_history = []
        session._get_model_context_limit = MagicMock(return_value=100)

        await session._maybe_archive_old_messages()

        session._get_model_context_limit.assert_not_called()

    @pytest.mark.asyncio
    async def test_skips_when_below_threshold(self):
        session = _make_session()
        # 10 messages × 100 chars = 1000 chars → ~250 tokens; limit 1000 → 75% = 750 → no archive
        session.chat_history = [_msg(i) for i in range(10)]
        session._model_context_limit = 1000
        original_history = list(session.chat_history)

        await session._maybe_archive_old_messages()

        assert session.chat_history == original_history


# ---------------------------------------------------------------------------
# _maybe_archive_old_messages — archiving logic
# ---------------------------------------------------------------------------

class TestMaybeArchiveLogic:
    def _make_fat_session(self):
        """Session where token count exceeds 75% of the limit."""
        session = _make_session()
        # 400 messages × 100 chars = 40_000 chars → 10_000 tokens
        # limit = 1_000 → 75% = 750 → must archive down to 50% = 500
        session.chat_history = [_msg(i, "x" * 100) for i in range(400)]
        session._model_context_limit = 1_000
        return session

    @pytest.mark.asyncio
    async def test_oldest_messages_removed_from_history(self):
        session = self._make_fat_session()
        original_ids = [m["id"] for m in session.chat_history]

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=MagicMock(status_code=200))
            mock_client_cls.return_value = mock_client

            await session._maybe_archive_old_messages()

        remaining_ids = [m["id"] for m in session.chat_history]
        # Oldest messages should be gone
        assert original_ids[0] not in remaining_ids
        # Some messages should remain
        assert len(session.chat_history) > 0
        assert len(session.chat_history) < 400

    @pytest.mark.asyncio
    async def test_history_shrinks_to_near_50_percent(self):
        session = self._make_fat_session()
        limit = session._model_context_limit

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=MagicMock(status_code=200))
            mock_client_cls.return_value = mock_client

            await session._maybe_archive_old_messages()

        remaining_tokens = sum(len(m.get("content", "")) for m in session.chat_history) // 4
        assert remaining_tokens <= 0.50 * limit * 1.1  # 10% slack for rounding

    @pytest.mark.asyncio
    async def test_api_called_with_archived_message_ids(self):
        session = self._make_fat_session()
        posted_bodies = []

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)

            async def capture_post(url, json=None, **kwargs):
                posted_bodies.append(json)
                return MagicMock(status_code=200)

            mock_client.post = capture_post
            mock_client_cls.return_value = mock_client

            await session._maybe_archive_old_messages()

        assert len(posted_bodies) == 1
        assert "message_ids" in posted_bodies[0]
        assert len(posted_bodies[0]["message_ids"]) > 0

    @pytest.mark.asyncio
    async def test_indexes_to_pgvector_when_knowledge_available(self):
        session = self._make_fat_session()
        mock_knowledge = MagicMock()
        session.agent_factory._knowledge = mock_knowledge

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=MagicMock(status_code=200))
            mock_client_cls.return_value = mock_client

            with patch("agno.knowledge.document.Document", side_effect=lambda **kw: kw):
                await session._maybe_archive_old_messages()

        assert mock_knowledge.insert.called
        inserted_metas = [call.args[0]["meta"] for call in mock_knowledge.insert.call_args_list]
        assert all(m["source"] == "chat_history" for m in inserted_metas)
        assert all(m["user_id"] == "user-1" for m in inserted_metas)

    @pytest.mark.asyncio
    async def test_api_failure_does_not_raise(self):
        session = self._make_fat_session()

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(side_effect=Exception("network error"))
            mock_client_cls.return_value = mock_client

            # Must not raise
            await session._maybe_archive_old_messages()

    @pytest.mark.asyncio
    async def test_messages_without_id_skipped_in_api_call(self):
        session = _make_fat_session = _make_session()
        session._model_context_limit = 1_000
        # Mix: some messages with id, some without
        session.chat_history = []
        for i in range(200):
            msg = _msg(i, "x" * 100)
            if i % 2 == 0:
                msg["id"] = ""  # no id
            session.chat_history.append(msg)

        posted_bodies = []

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)

            async def capture_post(url, json=None, **kwargs):
                posted_bodies.append(json)
                return MagicMock(status_code=200)

            mock_client.post = capture_post
            mock_client_cls.return_value = mock_client

            await session._maybe_archive_old_messages()

        if posted_bodies:
            for mid in posted_bodies[0]["message_ids"]:
                assert mid  # no empty strings


# ---------------------------------------------------------------------------
# make_search_chat_history
# ---------------------------------------------------------------------------

class TestSearchChatHistory:
    def _make_result(self, content, role="user", ts="2024-01-01T00:00:00Z"):
        r = SimpleNamespace(
            content=content,
            meta={"role": role, "timestamp": ts},
        )
        return r

    def test_returns_formatted_results(self):
        from src.tools.chat_history import make_search_chat_history

        mock_knowledge = MagicMock()
        mock_knowledge.search.return_value = [
            self._make_result("Hello world", role="user", ts="2024-01-01T10:00:00Z"),
            self._make_result("Hi there", role="assistant", ts="2024-01-01T10:01:00Z"),
        ]

        fn = make_search_chat_history(mock_knowledge, "user-1")
        result = fn("hello")

        mock_knowledge.search.assert_called_once_with(
            "hello",
            filters={"user_id": "user-1", "source": "chat_history"},
            limit=5,
        )
        assert "Hello world" in result
        assert "Hi there" in result
        assert "2024-01-01T10:00:00Z" in result

    def test_returns_no_history_found_when_empty(self):
        from src.tools.chat_history import make_search_chat_history

        mock_knowledge = MagicMock()
        mock_knowledge.search.return_value = []

        fn = make_search_chat_history(mock_knowledge, "user-1")
        result = fn("anything")

        assert result == "No relevant history found."

    def test_respects_limit_param(self):
        from src.tools.chat_history import make_search_chat_history

        mock_knowledge = MagicMock()
        mock_knowledge.search.return_value = []

        fn = make_search_chat_history(mock_knowledge, "user-1")
        fn("query", limit=10)

        mock_knowledge.search.assert_called_once_with(
            "query",
            filters={"user_id": "user-1", "source": "chat_history"},
            limit=10,
        )

    def test_handles_search_exception_gracefully(self):
        from src.tools.chat_history import make_search_chat_history

        mock_knowledge = MagicMock()
        mock_knowledge.search.side_effect = Exception("pgvector down")

        fn = make_search_chat_history(mock_knowledge, "user-1")
        result = fn("query")

        assert "Could not search" in result

    def test_formats_without_timestamp_when_missing(self):
        from src.tools.chat_history import make_search_chat_history

        r = SimpleNamespace(content="No timestamp here", meta={"role": "user"})
        mock_knowledge = MagicMock()
        mock_knowledge.search.return_value = [r]

        fn = make_search_chat_history(mock_knowledge, "user-1")
        result = fn("query")

        assert "No timestamp here" in result
        assert "user" in result
        # No bracket timestamp prefix
        assert "[" not in result

    def test_each_user_scoped_independently(self):
        from src.tools.chat_history import make_search_chat_history

        mock_knowledge = MagicMock()
        mock_knowledge.search.return_value = []

        fn_a = make_search_chat_history(mock_knowledge, "user-A")
        fn_b = make_search_chat_history(mock_knowledge, "user-B")

        fn_a("q")
        fn_b("q")

        calls = mock_knowledge.search.call_args_list
        assert calls[0].kwargs["filters"]["user_id"] == "user-A"
        assert calls[1].kwargs["filters"]["user_id"] == "user-B"
