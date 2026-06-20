"""Backend session memory tests.

These tests verify the fix for "model says I only see your last message":
history is now passed to the agent as a List[Message] (multi-turn) when
using PayloadBackend, not as a text block embedded in the user message.

Coverage:
  - _build_history_messages          (unit)
  - _build_agent_input               (no history text injection)
  - _invoke_agent / run_fn           (integration path: PayloadBackend → List[Message],
                                      AgnoBackend → str, no history → str, blank → sentinel)
"""

from __future__ import annotations

import asyncio
import pytest
from unittest.mock import MagicMock

from src.server.redis_session import RedisSession
from src.storage.backend import AgnoBackend, PayloadBackend


# ── helpers ───────────────────────────────────────────────────────────────────

HISTORY_TWO_TURNS = [
    {"role": "user",      "content": "Какие магазины поблизости?", "id": "1", "timestamp": ""},
    {"role": "assistant", "content": "Вот ближайшие результаты.",   "id": "2", "timestamp": ""},
]


def make_session(chat_history=None, storage_backend=None) -> RedisSession:
    """Return a bare RedisSession with minimal state set."""
    session = RedisSession.__new__(RedisSession)
    session.context_items = []
    session._accumulated_tool_results = []
    session.chat_history = chat_history if chat_history is not None else []
    session.storage_backend = (
        storage_backend if storage_backend is not None else PayloadBackend(chat_history=[])
    )
    return session


def make_mock_agent():
    """Return a mock agent that records calls to arun() and returns a plain value."""
    captured: dict = {}

    def fake_arun(inp, **kwargs):
        captured["inp"] = inp
        return MagicMock()  # plain value — not a coroutine, not an async generator

    agent = MagicMock()
    agent.arun = fake_arun
    del agent.run  # ensure only arun branch is taken
    return agent, captured


# ── _build_history_messages ───────────────────────────────────────────────────

class TestBuildHistoryMessages:
    def test_converts_history_to_message_objects(self):
        session = make_session(chat_history=HISTORY_TWO_TURNS)
        msgs = session._build_history_messages("новый вопрос")

        assert len(msgs) == 3
        assert msgs[0].role == "user"
        assert msgs[0].content == "Какие магазины поблизости?"
        assert msgs[1].role == "assistant"
        assert msgs[1].content == "Вот ближайшие результаты."
        assert msgs[2].role == "user"
        assert msgs[2].content == "новый вопрос"

    def test_empty_history_returns_only_current(self):
        session = make_session(chat_history=[])
        msgs = session._build_history_messages("solo")
        assert len(msgs) == 1
        assert msgs[0].role == "user"
        assert msgs[0].content == "solo"

    def test_skips_entries_with_no_content(self):
        history = [
            {"role": "user",      "content": "real message",  "id": "1", "timestamp": ""},
            {"role": "assistant", "content": "",               "id": "2", "timestamp": ""},  # empty
            {"role": "assistant", "content": "real reply",     "id": "3", "timestamp": ""},
        ]
        session = make_session(chat_history=history)
        msgs = session._build_history_messages("follow-up")
        # Empty-content entry is skipped; 3 real messages + current = 3
        contents = [m.content for m in msgs]
        assert "" not in contents
        assert "real message" in contents
        assert "real reply" in contents
        assert "follow-up" in contents

    def test_blank_current_message_not_appended(self):
        session = make_session(chat_history=HISTORY_TWO_TURNS)
        msgs = session._build_history_messages("   ")
        # Blank text → nothing appended
        assert len(msgs) == 2
        assert msgs[-1].role == "assistant"

    def test_preserves_message_order(self):
        history = [
            {"role": "user",      "content": "msg1", "id": "1", "timestamp": ""},
            {"role": "assistant", "content": "msg2", "id": "2", "timestamp": ""},
            {"role": "user",      "content": "msg3", "id": "3", "timestamp": ""},
            {"role": "assistant", "content": "msg4", "id": "4", "timestamp": ""},
        ]
        session = make_session(chat_history=history)
        msgs = session._build_history_messages("msg5")
        contents = [m.content for m in msgs]
        assert contents == ["msg1", "msg2", "msg3", "msg4", "msg5"]


# ── _build_agent_input ────────────────────────────────────────────────────────

class TestBuildAgentInput:
    def test_no_history_text_injection(self):
        """History must NOT appear as embedded text in agent input."""
        session = make_session(chat_history=HISTORY_TWO_TURNS)
        result = session._build_agent_input("новый вопрос")
        assert "[Conversation history]" not in result
        assert "Какие магазины поблизости?" not in result
        assert "Вот ближайшие результаты" not in result

    def test_returns_bare_message_when_no_context_items(self):
        """When there are no context items or tool results, input is the raw message."""
        session = make_session(chat_history=HISTORY_TWO_TURNS)
        result = session._build_agent_input("новый вопрос")
        assert result == "новый вопрос"

    def test_empty_history_returns_bare_message(self):
        session = make_session(chat_history=[])
        result = session._build_agent_input("hello")
        assert result == "hello"
        assert "[Conversation history]" not in result


# ── _invoke_agent / run_fn ────────────────────────────────────────────────────

class TestInvokeAgentRunFn:
    """Verify what is passed as `inp` to agent.arun() in different backend modes."""

    @pytest.mark.asyncio
    async def test_payload_backend_with_history_passes_list_of_messages(self):
        """PayloadBackend + history → agent receives List[Message], not a string."""
        session = make_session(
            chat_history=HISTORY_TWO_TURNS,
            storage_backend=PayloadBackend(chat_history=HISTORY_TWO_TURNS),
        )
        agent, captured = make_mock_agent()

        await session._invoke_agent(agent, "новый вопрос", {})

        inp = captured.get("inp")
        assert inp is not None
        assert isinstance(inp, list), f"Expected list, got {type(inp)}: {inp!r}"
        assert len(inp) == 3  # 2 history turns + current message
        assert inp[-1].role == "user"
        assert inp[-1].content == "новый вопрос"

    @pytest.mark.asyncio
    async def test_agno_backend_with_history_passes_string(self):
        """AgnoBackend → agent receives plain string (Agno manages its own history)."""
        session = make_session(
            chat_history=HISTORY_TWO_TURNS,
            storage_backend=AgnoBackend(session_id="sess-1"),
        )
        agent, captured = make_mock_agent()

        await session._invoke_agent(agent, "новый вопрос", {})

        inp = captured.get("inp")
        assert isinstance(inp, str), f"Expected str, got {type(inp)}: {inp!r}"
        assert inp == "новый вопрос"

    @pytest.mark.asyncio
    async def test_payload_backend_no_history_passes_string(self):
        """PayloadBackend with empty history → plain string (first message in session)."""
        session = make_session(
            chat_history=[],
            storage_backend=PayloadBackend(chat_history=[]),
        )
        agent, captured = make_mock_agent()

        await session._invoke_agent(agent, "first message", {})

        inp = captured.get("inp")
        assert isinstance(inp, str)
        assert inp == "first message"

    @pytest.mark.asyncio
    async def test_blank_message_with_no_history_becomes_sentinel(self):
        """Blank input with no history → '[continue from previous context]' sentinel."""
        session = make_session(
            chat_history=[],
            storage_backend=PayloadBackend(chat_history=[]),
        )
        agent, captured = make_mock_agent()

        await session._invoke_agent(agent, "   ", {})

        inp = captured.get("inp")
        assert inp == "[continue from previous context]"

    @pytest.mark.asyncio
    async def test_list_message_contains_full_history_in_order(self):
        """All history turns must be present in the correct order before current message."""
        history = [
            {"role": "user",      "content": "turn-1 user",  "id": "1", "timestamp": ""},
            {"role": "assistant", "content": "turn-1 asst",  "id": "2", "timestamp": ""},
            {"role": "user",      "content": "turn-2 user",  "id": "3", "timestamp": ""},
            {"role": "assistant", "content": "turn-2 asst",  "id": "4", "timestamp": ""},
        ]
        session = make_session(
            chat_history=history,
            storage_backend=PayloadBackend(chat_history=history),
        )
        agent, captured = make_mock_agent()

        await session._invoke_agent(agent, "turn-3 user", {})

        msgs = captured["inp"]
        assert isinstance(msgs, list)
        contents = [m.content for m in msgs]
        assert contents == ["turn-1 user", "turn-1 asst", "turn-2 user", "turn-2 asst", "turn-3 user"]

    @pytest.mark.asyncio
    async def test_non_string_input_bypasses_history_logic(self):
        """If agent_input is already a list (e.g. re-entrant call), it passes through."""
        from agno.models.message import Message

        session = make_session(
            chat_history=HISTORY_TWO_TURNS,
            storage_backend=PayloadBackend(chat_history=HISTORY_TWO_TURNS),
        )
        agent, captured = make_mock_agent()

        pre_built = [Message(role="user", content="pre-built")]
        await session._invoke_agent(agent, pre_built, {})  # type: ignore[arg-type]

        # Non-string input is forwarded unchanged
        assert captured["inp"] is pre_built
