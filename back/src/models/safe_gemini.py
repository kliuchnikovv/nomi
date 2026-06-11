"""
SafeGemini wrapper that filters empty parts from history.

This is a workaround for Gemini API bug where empty parts in history
cause 400 INVALID_ARGUMENT errors. When Gemini returns a response with
empty text, it gets stored in history as {"parts": [], "role": "model"},
which Gemini API rejects on subsequent requests.

See:
- https://github.com/agno-agi/agno/issues/2649
- https://github.com/agno-agi/agno/issues/5843
- https://github.com/pydantic/pydantic-ai/issues/3504
"""

import logging

from agno.models.google import Gemini
from agno.models.message import Message
from agno.models.response import ModelResponse
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)
import google.api_core.exceptions

from src.core.gemini_keys import KEY_MANAGER, is_quota_error

logger = logging.getLogger(__name__)


def _rotate_on_exhaust(retry_state) -> None:
    """tenacity before_sleep hook: log the retry and, on a quota error, rotate
    the Gemini API key onto the model instance so the next attempt uses a fresh
    project's quota.
    """
    exc = retry_state.outcome.exception() if retry_state.outcome else None
    logger.warning(
        "[SafeGemini] retry %d after error: %s",
        retry_state.attempt_number,
        exc,
    )
    if not is_quota_error(exc) or KEY_MANAGER.count <= 1:
        return
    new_key = KEY_MANAGER.rotate("ResourceExhausted")
    # The wrapped method is `invoke(self, ...)`, so args[0] is the model instance.
    model = retry_state.args[0] if retry_state.args else None
    if model is not None:
        model.api_key = new_key
        # agno's Gemini caches the client in `self.client`; clear it to force a
        # rebuild with the rotated key on the next call.
        model.client = None


class SafeGemini(Gemini):
    """
    A Gemini model wrapper that filters out empty parts from messages
    before sending them to API, preventing 400 INVALID_ARGUMENT errors.

    Also supports native Gemini 2.5 thinking/reasoning via thinking_budget
    and include_thoughts parameters (compatible with function calling).
    """

    _warned_tools: set[str] = set()

    def __init__(
        self,
        id: str = "gemini-2.5-flash",
        thinking_budget: int | None = None,
        include_thoughts: bool = False,
        **kwargs,
    ):
        """
        Initialize SafeGemini with optional thinking support.

        Args:
            id: Model ID (e.g. "gemini-2.5-flash", "gemini-2.5-flash-lite")
            thinking_budget: Number of tokens for thinking (Gemini 2.5+ native reasoning)
            include_thoughts: Whether to include thinking in output (Gemini 2.5+ native reasoning)
            **kwargs: Other Gemini parameters
        """
        super().__init__(
            id=id,
            thinking_budget=thinking_budget,
            include_thoughts=include_thoughts,
            **kwargs,
        )

    def _filter_empty_parts(self, messages: list[Message]) -> list[Message]:
        filtered_messages = []

        for msg in messages:
            # DEBUG: Log tool messages to find application/json issue
            # if msg.role == "tool":
            #     logger.info(
            #         f"[SafeGemini DEBUG] Tool Message: content_type={type(msg.content)} content={msg.content}"
            #     )
            # if isinstance(msg.content, list):
            #     for i, part in enumerate(msg.content):
            #         logger.info(f"[SafeGemini DEBUG] Part {i}: {part}")

            # Check if message has content
            if msg.content is None:
                # IMPORTANT: Never filter out system messages, even if they have None content
                # This prevents "contents are required" errors when system messages are missing content
                if msg.role == "system":
                    filtered_messages.append(msg)
                    continue
                # Skip other messages with no content at all
                continue

            # If content is a string, check if it's empty
            if isinstance(msg.content, str):
                if not msg.content.strip():
                    logger.debug(
                        "[SafeGemini] Skipping message with empty string content"
                    )
                    continue

            # If content is a list (parts), filter empty parts
            if isinstance(msg.content, list):
                filtered_parts = []
                for part in msg.content:
                    if part is None:
                        continue
                    if isinstance(part, str) and not part.strip():
                        continue
                    if isinstance(part, dict):
                        # Check for empty text parts like {"text": ""}
                        if part.get("text") == "" or part.get("text") is None:
                            if len(part) == 1:  # Only has text field
                                continue
                    filtered_parts.append(part)

                if not filtered_parts:
                    logger.debug("[SafeGemini] Skipping message with all empty parts")
                    continue

                # Create a new message with filtered parts
                msg = Message(
                    role=msg.role,
                    content=filtered_parts,
                    **{
                        k: v
                        for k, v in msg.__dict__.items()
                        if k not in ["role", "content"]
                    },
                )

            filtered_messages.append(msg)

        # Ensure we never return an empty list - API requires at least one message
        if not filtered_messages and messages:
            # If all messages were filtered, keep messages with roles that should never be empty
            # (user, system) - even if they have minimal content
            # IMPORTANT: Always keep system messages, even if content is None,
            # to ensure the API has valid context
            for msg in messages:
                if msg.role == "system":
                    filtered_messages.append(msg)
                    logger.debug(
                        "[SafeGemini] Kept %s message to prevent empty list", msg.role
                    )
                    break
                if msg.role == "user" and msg.content is not None:
                    filtered_messages.append(msg)
                    logger.debug(
                        "[SafeGemini] Kept %s message to prevent empty list", msg.role
                    )
                    break

            # If still empty, keep the first non-tool message
            if not filtered_messages:
                for msg in messages:
                    if msg.role != "tool":
                        filtered_messages.append(msg)
                        logger.debug(
                            "[SafeGemini] Kept first non-tool message to prevent empty list"
                        )
                        break

        return filtered_messages

    @staticmethod
    def _prop_has_valid_schema(prop_def: dict) -> bool:
        """Return True if a property schema will survive convert_schema with a usable type.

        Properties that convert_schema maps to None (empty schema, no type, no anyOf/enum/$ref)
        are left as Schema(type=None) by the fallback, and Gemini API treats those as
        "not defined" even though the key exists in properties.
        """
        if not isinstance(prop_def, dict):
            return False
        prop_type = prop_def.get("type")
        # Type must be present and not null/empty string
        if prop_type and prop_type not in ("null", ""):
            return True
        # Has enum or other schema keywords
        return bool(
            prop_def.get("anyOf")
            or prop_def.get("oneOf")
            or prop_def.get("allOf")
            or prop_def.get("enum")
            or prop_def.get("$ref")
        )

    @staticmethod
    def _remove_empty_required(schema: dict) -> dict:
        """Recursively remove empty ``required: []`` arrays from a JSON Schema.

        Gemini API rejects ``required: []`` (empty list) in some cases, so we
        strip the key entirely when the list is empty.  This is applied
        recursively to nested ``properties`` objects as well.
        """
        if not isinstance(schema, dict):
            return schema
        result = {**schema}
        if "required" in result and not result["required"]:
            del result["required"]
        # Recurse into nested object properties
        if "properties" in result:
            new_props = {}
            for prop_name, prop_def in result["properties"].items():
                if isinstance(prop_def, dict) and prop_def.get("type") == "object":
                    new_props[prop_name] = SafeGemini._remove_empty_required(prop_def)
                else:
                    new_props[prop_name] = prop_def
            result["properties"] = new_props
        return result

    def _sanitize_tool_schemas(self, tools: list[dict]) -> list[dict]:
        """Remove required[] entries that Gemini would reject.

        Three cases handled:
        1. Required field not present in properties at all.
        2. Required field present but its schema is empty/untyped — convert_schema
           returns None and the fallback Schema(type=None) is ignored by Gemini API.
        3. Empty ``required: []`` array — Gemini rejects this entirely.
        """
        sanitized = []
        for tool in tools:
            if tool.get("type") == "function":
                func_info = tool.get("function", {})
                params = func_info.get("parameters", {})
                modified = False

                if "required" in params:
                    properties = params.get("properties", {})
                    defined = {
                        k
                        for k, v in properties.items()
                        if self._prop_has_valid_schema(v)
                    }
                    original = params["required"]
                    filtered = [r for r in original if r in defined]

                    if len(filtered) != len(original):
                        removed = set(original) - set(filtered)
                        tool_key = f"drop:{func_info.get('name', '?')}:{frozenset(removed)}"
                        if tool_key not in SafeGemini._warned_tools:
                            SafeGemini._warned_tools.add(tool_key)
                            logger.debug(
                                "[SafeGemini] Dropping required fields from '%s': %s",
                                func_info.get("name", "?"),
                                removed,
                            )
                        modified = True

                    # Remove empty required arrays entirely
                    if not filtered:
                        tool_key = f"empty:{func_info.get('name', '?')}"
                        if tool_key not in SafeGemini._warned_tools:
                            SafeGemini._warned_tools.add(tool_key)
                            logger.debug(
                                "[SafeGemini] Removing empty required[] from '%s'",
                                func_info.get("name", "?"),
                            )
                        params = {k: v for k, v in params.items() if k != "required"}
                        modified = True
                    else:
                        params = {**params, "required": filtered}

                # Recursively clean nested object properties
                params = self._remove_empty_required(params)

                if modified or params is not func_info.get("parameters"):
                    tool = {
                        **tool,
                        "function": {
                            **func_info,
                            "parameters": params,
                        },
                    }
            sanitized.append(tool)
        return sanitized

    def get_request_params(
        self,
        system_message=None,
        response_format=None,
        tools=None,
        tool_choice=None,
    ):
        """Override to sanitize tool schemas before sending to Gemini."""
        if tools:
            tools = self._sanitize_tool_schemas(tools)
        return super().get_request_params(
            system_message=system_message,
            response_format=response_format,
            tools=tools,
            tool_choice=tool_choice,
        )

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type(
            (
                google.api_core.exceptions.InternalServerError,
                google.api_core.exceptions.ServiceUnavailable,
                google.api_core.exceptions.ResourceExhausted,
                google.api_core.exceptions.DeadlineExceeded,
            )
        ),
        before_sleep=_rotate_on_exhaust,
        reraise=True,
    )
    def invoke(self, messages: list[Message], *args, **kwargs) -> ModelResponse:
        """Override invoke to filter empty parts before calling parent."""
        filtered = self._filter_empty_parts(messages)
        logger.debug(
            "[SafeGemini] Filtered %d -> %d messages", len(messages), len(filtered)
        )
        return super().invoke(filtered, *args, **kwargs)

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type(
            (
                google.api_core.exceptions.InternalServerError,
                google.api_core.exceptions.ServiceUnavailable,
                google.api_core.exceptions.ResourceExhausted,
                google.api_core.exceptions.DeadlineExceeded,
            )
        ),
        before_sleep=_rotate_on_exhaust,
        reraise=True,
    )
    async def ainvoke(self, messages: list[Message], *args, **kwargs) -> ModelResponse:
        """Override ainvoke to filter empty parts before calling parent."""
        filtered = self._filter_empty_parts(messages)
        logger.debug(
            "[SafeGemini] Filtered %d -> %d messages", len(messages), len(filtered)
        )
        return await super().ainvoke(filtered, *args, **kwargs)

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type(
            (
                google.api_core.exceptions.InternalServerError,
                google.api_core.exceptions.ServiceUnavailable,
                google.api_core.exceptions.ResourceExhausted,
                google.api_core.exceptions.DeadlineExceeded,
            )
        ),
        before_sleep=_rotate_on_exhaust,
        reraise=True,
    )
    def invoke_stream(self, messages: list[Message], *args, **kwargs) -> ModelResponse:
        """Override invoke_stream to filter empty parts before calling parent."""
        filtered = self._filter_empty_parts(messages)
        logger.debug(
            "[SafeGemini] Filtered %d -> %d messages (stream)",
            len(messages),
            len(filtered),
        )
        return super().invoke_stream(filtered, *args, **kwargs)

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type(
            (
                google.api_core.exceptions.InternalServerError,
                google.api_core.exceptions.ServiceUnavailable,
                google.api_core.exceptions.ResourceExhausted,
                google.api_core.exceptions.DeadlineExceeded,
            )
        ),
        before_sleep=_rotate_on_exhaust,
        reraise=True,
    )
    async def ainvoke_stream(self, messages: list[Message], *args, **kwargs):
        """Override ainvoke_stream to filter empty parts before calling parent."""
        filtered = self._filter_empty_parts(messages)
        logger.debug(
            "[SafeGemini] Filtered %d -> %d messages (astream)",
            len(messages),
            len(filtered),
        )
        async for response in super().ainvoke_stream(filtered, *args, **kwargs):
            yield response
