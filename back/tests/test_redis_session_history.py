"""Tests for native Agno history message passing."""


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


def test_build_agent_input_excludes_history_text():
    """_build_agent_input must not inject history as a text block."""
    session = make_session_with_history()
    result = session._build_agent_input("новый вопрос")
    assert "[IMPORTANT: The following is your conversation history" not in result


def test_build_agent_input_includes_current_message():
    """_build_agent_input must still return the current user message."""
    session = make_session_with_history()
    result = session._build_agent_input("новый вопрос")
    assert "новый вопрос" in result


def test_build_history_messages_count():
    """_build_history_messages must include all history entries plus current message."""
    session = make_session_with_history()
    msgs = session._build_history_messages("новый вопрос")
    # 2 history messages + 1 current
    assert len(msgs) == 3


def test_build_history_messages_roles():
    """History messages must preserve roles; current message is always user."""
    from agno.models.message import Message

    session = make_session_with_history()
    msgs = session._build_history_messages("новый вопрос")

    assert all(isinstance(m, Message) for m in msgs)
    assert msgs[0].role == "user"
    assert msgs[1].role == "assistant"
    assert msgs[2].role == "user"
    assert msgs[2].content == "новый вопрос"


def test_build_history_messages_empty_history():
    """With no history, _build_history_messages returns just the current message."""
    from src.server.redis_session import RedisSession

    session = RedisSession.__new__(RedisSession)
    session.chat_history = []
    msgs = session._build_history_messages("solo message")
    assert len(msgs) == 1
    assert msgs[0].content == "solo message"
