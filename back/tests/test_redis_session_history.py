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


def test_build_agent_input_no_history_injection():
    """History must NOT appear as a text block in agent input — it is passed via List[Message]."""
    session = make_session_with_history()
    result = session._build_agent_input("новый вопрос")
    assert "[Conversation history]" not in result
    assert "Какие магазины поблизости?" not in result


def test_build_agent_input_includes_current_message():
    """Current user message must be returned as-is when there are no context items."""
    session = make_session_with_history()
    result = session._build_agent_input("новый вопрос")
    assert result == "новый вопрос"


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


def test_build_history_messages_produces_multi_turn():
    """_build_history_messages must return history + current message as Message objects."""
    session = make_session_with_history()
    msgs = session._build_history_messages("новый вопрос")
    assert len(msgs) == 3
    assert msgs[0].role == "user"
    assert msgs[0].content == "Какие магазины поблизости?"
    assert msgs[1].role == "assistant"
    assert msgs[2].role == "user"
    assert msgs[2].content == "новый вопрос"


def test_build_history_messages_empty_history():
    """With no history, _build_history_messages returns only the current message."""
    from src.server.redis_session import RedisSession

    session = RedisSession.__new__(RedisSession)
    session.context_items = []
    session._accumulated_tool_results = []
    session.chat_history = []
    msgs = session._build_history_messages("solo message")
    assert len(msgs) == 1
    assert msgs[0].role == "user"
    assert msgs[0].content == "solo message"
