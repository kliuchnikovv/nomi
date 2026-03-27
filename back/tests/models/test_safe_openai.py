import pytest
from unittest.mock import MagicMock, patch
from agno.models.message import Message

from src.models.safe_openai import SafeOpenAI


class TestNormalizeMessages:
    def test_convert_developer_to_user(self):
        model = SafeOpenAI()
        messages = [
            Message(role="developer", content="You are a helpful assistant"),
        ]
        result = model._normalize_messages(messages)
        assert len(result) == 1
        assert result[0].role == "user"
        assert "System:" in result[0].content

    def test_convert_system_to_user(self):
        model = SafeOpenAI()
        messages = [
            Message(role="system", content="You are a helpful assistant"),
        ]
        result = model._normalize_messages(messages)
        assert len(result) == 1
        assert result[0].role == "user"
        assert "System:" in result[0].content

    def test_filter_tool_role(self):
        model = SafeOpenAI()
        messages = [
            Message(role="user", content="Hello"),
            Message(role="tool", content="Tool result", tool_call_id="123"),
        ]
        result = model._normalize_messages(messages)
        assert len(result) == 1
        assert result[0].role == "user"

    def test_remove_tool_calls_from_assistant(self):
        model = SafeOpenAI()
        msg = Message(role="assistant", content="I'll help you")
        msg.tool_calls = [{"id": "call_123", "name": "test"}]
        messages = [msg]
        result = model._normalize_messages(messages)
        assert len(result) == 1
        assert not hasattr(result[0], "tool_calls") or result[0].tool_calls is None

    def test_preserve_user_messages(self):
        model = SafeOpenAI()
        messages = [
            Message(role="user", content="Hello"),
        ]
        result = model._normalize_messages(messages)
        assert len(result) == 1
        assert result[0].role == "user"
        assert result[0].content == "Hello"

    def test_preserve_assistant_messages_without_tool_calls(self):
        model = SafeOpenAI()
        messages = [
            Message(role="assistant", content="Hello"),
        ]
        result = model._normalize_messages(messages)
        assert len(result) == 1
        assert result[0].role == "assistant"

    def test_empty_after_filter_returns_original(self):
        model = SafeOpenAI()
        messages = [
            Message(role="tool", content="result"),
        ]
        result = model._normalize_messages(messages)
        assert result == messages


class TestInvokeMethods:
    @patch("src.models.safe_openai.OpenAIChat.invoke")
    def test_invoke_calls_parent_with_normalized(self, mock_invoke):
        model = SafeOpenAI()
        mock_invoke.return_value = MagicMock()
        messages = [
            Message(role="developer", content="System prompt"),
            Message(role="user", content="Hello"),
        ]
        model.invoke(messages)
        mock_invoke.assert_called_once()
        called_messages = mock_invoke.call_args[0][0]
        assert all(m.role != "developer" for m in called_messages)

    @patch("src.models.safe_openai.OpenAIChat.ainvoke")
    @pytest.mark.asyncio
    async def test_ainvoke_calls_parent_with_normalized(self, mock_ainvoke):
        model = SafeOpenAI()
        mock_ainvoke.return_value = MagicMock()
        messages = [
            Message(role="system", content="System prompt"),
            Message(role="user", content="Hello"),
        ]
        await model.ainvoke(messages)
        mock_ainvoke.assert_called_once()
        called_messages = mock_ainvoke.call_args[0][0]
        assert all(m.role != "system" for m in called_messages)

    @patch("src.models.safe_openai.OpenAIChat.invoke_stream")
    def test_invoke_stream_normalizes_messages(self, mock_stream):
        model = SafeOpenAI()
        mock_stream.return_value = iter([MagicMock()])
        messages = [
            Message(role="tool", content="result"),
            Message(role="user", content="Hello"),
        ]
        list(model.invoke_stream(messages))
        mock_stream.assert_called_once()
        called_messages = mock_stream.call_args[0][0]
        assert len(called_messages) == 1
