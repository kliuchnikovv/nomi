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
        # "tool" role messages are preserved (not filtered) so the model can
        # see tool results and avoid infinite tool-call loops.
        assert len(result) == 2
        assert result[0].role == "user"
        assert result[1].role == "tool"

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
        # "tool" role messages are preserved so the model can see tool results.
        assert len(called_messages) == 2


class TestToolSchemaSanitization:
    """z.ai/GLM rejects union schemas and untyped properties with
    "Tool type cannot be empty" (error 1214). Optional params are emitted by
    Agno as ``{"anyOf": [{"type": "string"}, {"type": "null"}]}`` with no
    top-level ``type`` — these must be collapsed to a concrete typed schema.
    """

    def test_anyof_optional_collapsed_to_concrete_type(self):
        # Mirrors Agno's serialization of `query: str | None = None`.
        schema = {
            "type": "object",
            "properties": {
                "query": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            },
            "required": [],
        }
        out = SafeOpenAI._sanitize_tool_schema(schema)
        q = out["properties"]["query"]
        assert q.get("type") == "string"
        assert "anyOf" not in q
        # empty required arrays are dropped
        assert "required" not in out

    def test_anyof_preserves_sibling_description(self):
        schema = {
            "anyOf": [{"type": "string"}, {"type": "null"}],
            "description": "the search query",
        }
        out = SafeOpenAI._sanitize_tool_schema(schema)
        assert out.get("type") == "string"
        assert out.get("description") == "the search query"
        assert "anyOf" not in out

    def test_oneof_also_collapsed(self):
        schema = {"oneOf": [{"type": "integer"}, {"type": "null"}]}
        out = SafeOpenAI._sanitize_tool_schema(schema)
        assert out.get("type") == "integer"
        assert "oneOf" not in out

    def test_sanitize_tools_produces_typed_properties(self):
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "search_emails",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "anyOf": [{"type": "string"}, {"type": "null"}]
                            },
                            "limit": {"type": "number"},
                        },
                        "required": [],
                    },
                    "strict": True,
                },
            }
        ]
        out = SafeOpenAI()._sanitize_tools(tools)
        props = out[0]["function"]["parameters"]["properties"]
        assert props["query"]["type"] == "string"
        assert "anyOf" not in props["query"]
        assert "strict" not in out[0]["function"]

    def test_untyped_property_defaults_to_string(self):
        # Unannotated params / **kwargs serialize to an empty `{}` schema.
        schema = {
            "type": "object",
            "properties": {"x": {}, "y": {"type": "string"}},
        }
        out = SafeOpenAI._sanitize_tools(
            SafeOpenAI(),
            [{"type": "function", "function": {"name": "f", "parameters": schema}}],
        )
        props = out[0]["function"]["parameters"]["properties"]
        assert props["x"]["type"] == "string"
        assert props["y"]["type"] == "string"

    def test_object_without_type_inferred(self):
        schema = {
            "type": "object",
            "properties": {
                "m": {"properties": {"a": {"type": "integer"}}, "required": ["a"]},
            },
        }
        out = SafeOpenAI()._sanitize_tools(
            [{"type": "function", "function": {"name": "f", "parameters": schema}}]
        )
        assert out[0]["function"]["parameters"]["properties"]["m"]["type"] == "object"

    def test_array_items_without_type_inferred(self):
        schema = {
            "type": "object",
            "properties": {"xs": {"type": "array", "items": {}}},
        }
        out = SafeOpenAI()._sanitize_tools(
            [{"type": "function", "function": {"name": "f", "parameters": schema}}]
        )
        assert (
            out[0]["function"]["parameters"]["properties"]["xs"]["items"]["type"]
            == "string"
        )

    def test_enum_without_type_inferred(self):
        schema = {
            "type": "object",
            "properties": {"status": {"enum": ["read", "unread"]}},
        }
        out = SafeOpenAI()._sanitize_tools(
            [{"type": "function", "function": {"name": "f", "parameters": schema}}]
        )
        assert out[0]["function"]["parameters"]["properties"]["status"]["type"] == "string"

    def test_phantom_required_field_dropped(self):
        """`required: ["kwargs"]` with no matching property is dropped.

        Agno's client-proxy generator wraps tools as `_proxy(**kwargs)`, and
        process_entrypoint() overwrites `required` with `["kwargs"]`. z.ai then
        can't resolve the required field's type → 400 "Tool type cannot be empty".
        """
        tool = {
            "type": "function",
            "function": {
                "name": "github_list_repos",
                "parameters": {
                    "type": "object",
                    "properties": {"limit": {"type": "integer"}},
                    "required": ["kwargs"],
                },
            },
        }
        out = SafeOpenAI()._sanitize_tools([tool])
        params = out[0]["function"]["parameters"]
        assert "required" not in params or params["required"] == []
        # real properties are preserved
        assert params["properties"]["limit"]["type"] == "integer"

    def test_partial_phantom_required_keeps_valid(self):
        tool = {
            "type": "function",
            "function": {
                "name": "f",
                "parameters": {
                    "type": "object",
                    "properties": {"owner": {"type": "string"}},
                    "required": ["owner", "kwargs"],
                },
            },
        }
        out = SafeOpenAI()._sanitize_tools([tool])
        assert out[0]["function"]["parameters"]["required"] == ["owner"]

    def test_format_tools_collapses_anyof(self):
        """_format_tools is always on the request path — it must fully sanitize.

        A dict tool exercises Agno's builtin-tool passthrough; the override must
        still collapse unions and strip unsupported keys.
        """
        tool = {
            "type": "function",
            "function": {
                "name": "search_emails",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                    },
                    "required": [],
                },
                "strict": True,
            },
        }
        model = SafeOpenAI()
        out = model._format_tools([tool])
        q = out[0]["function"]["parameters"]["properties"]["query"]
        assert q.get("type") == "string"
        assert "anyOf" not in q
        assert "strict" not in out[0]["function"]
