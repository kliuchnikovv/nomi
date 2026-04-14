import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from agno.models.message import Message
import google.api_core.exceptions

from src.models.safe_gemini import SafeGemini


class TestFilterEmptyParts:
    def test_skip_none_content_except_system(self):
        model = SafeGemini()
        messages = [
            Message(role="user", content=None),
            Message(role="system", content=None),
        ]
        result = model._filter_empty_parts(messages)
        assert len(result) == 1
        assert result[0].role == "system"

    def test_skip_empty_string(self):
        model = SafeGemini()
        messages = [
            Message(role="user", content=""),
            Message(role="user", content="   "),
            Message(role="user", content="hello"),
        ]
        result = model._filter_empty_parts(messages)
        assert len(result) == 1
        assert result[0].content == "hello"

    def test_filter_empty_parts_in_list(self):
        model = SafeGemini()
        messages = [
            Message(role="model", content=[{"text": ""}, {"text": "hello"}]),
        ]
        result = model._filter_empty_parts(messages)
        assert len(result) == 1
        assert len(result[0].content) == 1
        assert result[0].content[0]["text"] == "hello"

    def test_filter_empty_dict_text_part(self):
        model = SafeGemini()
        messages = [
            Message(role="model", content=[{"text": ""}]),
        ]
        result = model._filter_empty_parts(messages)
        assert len(result) == 1

    def test_keep_non_empty_parts(self):
        model = SafeGemini()
        messages = [
            Message(role="model", content=[{"text": "hello"}, {"text": "world"}]),
        ]
        result = model._filter_empty_parts(messages)
        assert len(result) == 1
        assert len(result[0].content) == 2

    def test_never_return_empty_list(self):
        model = SafeGemini()
        messages = [
            Message(role="tool", content=[]),
            Message(role="user", content="hello"),
        ]
        result = model._filter_empty_parts(messages)
        assert len(result) >= 1
        assert result[0].role == "user"

    def test_keep_system_message_with_none_content(self):
        model = SafeGemini()
        messages = [
            Message(role="system", content=None),
            Message(role="tool", content=[]),
        ]
        result = model._filter_empty_parts(messages)
        assert len(result) == 1
        assert result[0].role == "system"

    def test_preserve_message_role_and_content(self):
        model = SafeGemini()
        msg = Message(role="user", content=[{"text": "hello"}])
        messages = [msg]
        result = model._filter_empty_parts(messages)
        assert len(result) == 1
        assert result[0].role == "user"
        assert result[0].content == [{"text": "hello"}]


class TestPropHasValidSchema:
    def test_valid_schema_with_type_string(self):
        result = SafeGemini._prop_has_valid_schema({"type": "string"})
        assert result is True

    def test_valid_schema_with_type_integer(self):
        result = SafeGemini._prop_has_valid_schema({"type": "integer"})
        assert result is True

    def test_invalid_null_type(self):
        result = SafeGemini._prop_has_valid_schema({"type": None})
        assert result is False

    def test_invalid_empty_string_type(self):
        result = SafeGemini._prop_has_valid_schema({"type": ""})
        assert result is False

    def test_valid_with_anyof(self):
        result = SafeGemini._prop_has_valid_schema({"anyOf": [{"type": "string"}]})
        assert result is True

    def test_valid_with_oneof(self):
        result = SafeGemini._prop_has_valid_schema({"oneOf": [{"type": "string"}]})
        assert result is True

    def test_valid_with_enum(self):
        result = SafeGemini._prop_has_valid_schema({"enum": ["a", "b"]})
        assert result is True

    def test_valid_with_ref(self):
        result = SafeGemini._prop_has_valid_schema({"$ref": "#/definitions/Foo"})
        assert result is True

    def test_invalid_empty_dict(self):
        result = SafeGemini._prop_has_valid_schema({})
        assert result is False

    def test_invalid_not_dict(self):
        result = SafeGemini._prop_has_valid_schema("string")
        assert result is False


class TestSanitizeToolSchemas:
    def test_remove_required_without_schema(self):
        model = SafeGemini()
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "test_func",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "required_field": {},
                            "valid_field": {"type": "string"},
                        },
                        "required": ["required_field", "valid_field"],
                    },
                },
            }
        ]
        result = model._sanitize_tool_schemas(tools)
        assert "required" in result[0]["function"]["parameters"]
        assert "required_field" not in result[0]["function"]["parameters"]["required"]
        assert "valid_field" in result[0]["function"]["parameters"]["required"]

    def test_keep_required_with_schema(self):
        model = SafeGemini()
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "test_func",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "age": {"type": "integer"},
                        },
                        "required": ["name", "age"],
                    },
                },
            }
        ]
        result = model._sanitize_tool_schemas(tools)
        required = result[0]["function"]["parameters"]["required"]
        assert "name" in required
        assert "age" in required

    def test_multiple_tools(self):
        model = SafeGemini()
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "func1",
                    "parameters": {
                        "type": "object",
                        "properties": {"a": {"type": "string"}},
                        "required": ["a"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "func2",
                    "parameters": {
                        "type": "object",
                        "properties": {"b": {}},
                        "required": ["b"],
                    },
                },
            },
        ]
        result = model._sanitize_tool_schemas(tools)
        assert len(result) == 2
        assert "a" in result[0]["function"]["parameters"]["required"]
        # When all required fields are invalid/untyped, the "required" key is
        # removed entirely (empty required[] is rejected by Gemini API).
        assert "required" not in result[1]["function"]["parameters"]

    def test_non_function_tool_unchanged(self):
        model = SafeGemini()
        tools = [{"type": "some_other_type"}]
        result = model._sanitize_tool_schemas(tools)
        assert result == tools


class TestInvokeMethods:
    @patch("src.models.safe_gemini.Gemini.invoke")
    def test_invoke_calls_parent_with_filtered(self, mock_invoke):
        model = SafeGemini()
        mock_invoke.return_value = MagicMock()
        messages = [
            Message(role="user", content="hello"),
            Message(role="model", content=[{"text": ""}]),
        ]
        model.invoke(messages)
        mock_invoke.assert_called_once()
        called_messages = mock_invoke.call_args[0][0]
        assert len(called_messages) == 1

    @patch("src.models.safe_gemini.Gemini.ainvoke")
    @pytest.mark.asyncio
    async def test_ainvoke_calls_parent_with_filtered(self, mock_ainvoke):
        model = SafeGemini()
        mock_ainvoke.return_value = AsyncMock()()
        messages = [
            Message(role="user", content="hello"),
            Message(role="model", content=[{"text": ""}]),
        ]
        await model.ainvoke(messages)
        mock_ainvoke.assert_called_once()
        called_messages = mock_ainvoke.call_args[0][0]
        assert len(called_messages) == 1

    @patch("src.models.safe_gemini.Gemini.invoke")
    def test_invoke_retries_on_internal_error(self, mock_invoke):
        model = SafeGemini()
        mock_invoke.side_effect = [
            google.api_core.exceptions.InternalServerError("error"),
            MagicMock(),
        ]
        messages = [Message(role="user", content="hello")]
        model.invoke(messages)
        assert mock_invoke.call_count == 2

    @patch("src.models.safe_gemini.Gemini.invoke")
    def test_invoke_raises_after_max_retries(self, mock_invoke):
        model = SafeGemini()
        mock_invoke.side_effect = google.api_core.exceptions.InternalServerError(
            "error"
        )
        messages = [Message(role="user", content="hello")]
        with pytest.raises(google.api_core.exceptions.InternalServerError):
            model.invoke(messages)
        assert mock_invoke.call_count == 3

    @patch("src.models.safe_gemini.Gemini.invoke_stream")
    def test_invoke_stream_filters_messages(self, mock_stream):
        model = SafeGemini()
        mock_stream.return_value = MagicMock()
        messages = [
            Message(role="user", content="hello"),
            Message(role="model", content=[{"text": ""}]),
        ]
        model.invoke_stream(messages)
        mock_stream.assert_called_once()
        called_messages = mock_stream.call_args[0][0]
        assert len(called_messages) == 1


class TestGetRequestParams:
    @patch("src.models.safe_gemini.Gemini.get_request_params")
    def test_get_request_params_sanitizes_tools(self, mock_get_params):
        model = SafeGemini()
        mock_get_params.return_value = {}
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "test",
                    "parameters": {
                        "type": "object",
                        "properties": {"x": {}},
                        "required": ["x"],
                    },
                },
            }
        ]
        model.get_request_params(tools=tools)
        call_args = mock_get_params.call_args
        passed_tools = call_args.kwargs.get("tools") or call_args[1].get("tools")
        # When all required fields are invalid/untyped, the "required" key is
        # removed entirely (empty required[] is rejected by Gemini API).
        assert "required" not in passed_tools[0]["function"]["parameters"]

    @patch("src.models.safe_gemini.Gemini.get_request_params")
    def test_get_request_params_no_tools(self, mock_get_params):
        model = SafeGemini()
        mock_get_params.return_value = {}
        model.get_request_params()
        mock_get_params.assert_called_once()
