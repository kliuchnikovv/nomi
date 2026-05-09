"""Tests for conversation history injection in _build_agent_input."""


def make_session_with_history():
    """Return a bare RedisSession with chat_history populated."""
    from src.server.redis_session import RedisSession

    session = RedisSession.__new__(RedisSession)
    session.context_items = []
    session._accumulated_tool_results = []
    session.chat_history = [
        {"role": "user", "content": "Какие магазины поблизости?", "id": "1", "timestamp": ""},
        {"role": "assistant", "content": "Вот ближайшие результаты: магазин на улице Ленина.", "id": "2", "timestamp": ""},
    ]
    return session


def test_build_agent_input_includes_history_as_text():
    """History must appear as a text block (not a List[Message]) so Agno can track user_message."""
    session = make_session_with_history()
    result = session._build_agent_input("новый вопрос")
    assert "[Conversation history]" in result
    assert "Какие магазины поблизости?" in result
    assert "Вот ближайшие результаты" in result


def test_build_agent_input_includes_current_message():
    """Current user message must appear after the history block."""
    session = make_session_with_history()
    result = session._build_agent_input("новый вопрос")
    assert "новый вопрос" in result
    history_pos = result.index("[Conversation history]")
    current_pos = result.index("новый вопрос")
    assert current_pos > history_pos


def test_build_agent_input_no_history():
    """With no history, _build_agent_input returns just the current message."""
    from src.server.redis_session import RedisSession

    session = RedisSession.__new__(RedisSession)
    session.context_items = []
    session._accumulated_tool_results = []
    session.chat_history = []
    result = session._build_agent_input("solo message")
    assert result == "solo message"
    assert "[Conversation history]" not in result
