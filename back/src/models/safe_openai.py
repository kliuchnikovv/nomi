"""
SafeOpenAI wrapper that converts 'developer' and 'system' roles to 'user' for GLM models.

The OpenAI API (and some OpenAI-compatible APIs like GLM) use 'developer' role
for system instructions, but GLM models reject this with "Incorrect role information".
Additionally, some APIs (like Z.ai) don't support 'system' role at all.
This wrapper converts 'developer' to 'system', then 'system' to 'user' before sending to API.

Additionally, GLM models don't support 'tool' role messages, so we filter those out
and remove tool_calls from assistant messages since the API doesn't support them.

Tool schemas are also sanitized to remove fields incompatible with z.ai/GLM:
- ``strict: true`` removed (not supported)
- ``additionalProperties`` removed (not supported)
- Empty ``required: []`` arrays removed (causes "Tool type cannot be empty")
"""

import logging

from agno.models.openai import OpenAIChat
from agno.models.message import Message
from agno.models.response import ModelResponse

logger = logging.getLogger(__name__)


class SafeOpenAI(OpenAIChat):
    """
    An OpenAI-compatible model wrapper that converts 'developer' and 'system' roles
    to 'user', filters out 'tool' role messages, and removes tool_calls from assistant
    messages for APIs that don't support these features (e.g., GLM models, Z.ai).

    Also sanitizes tool schemas to remove ``strict``, ``additionalProperties``,
    and empty ``required: []`` arrays that cause ``400: Tool type cannot be empty``
    errors on z.ai/GLM endpoints.
    """

    # ------------------------------------------------------------------
    # Tool schema sanitization
    # ------------------------------------------------------------------

    @staticmethod
    def _sanitize_tool_schema(schema: dict) -> dict:
        """Recursively strip fields incompatible with z.ai / GLM APIs."""
        if not isinstance(schema, dict):
            return schema

        # Collapse ``anyOf`` / ``oneOf`` unions into a single concrete schema.
        # Agno serializes ``Optional[str]`` params as
        # ``{"anyOf": [{"type": "string"}, {"type": "null"}]}`` with no top-level
        # ``type``. z.ai/GLM does not support union schemas and rejects them with
        # ``400: Tool type cannot be empty`` (error 1214). Drop the ``null``
        # variant and lift the first concrete variant up, keeping sibling keys
        # (e.g. ``description``).
        for union_key in ("anyOf", "oneOf"):
            variants = schema.get(union_key)
            if isinstance(variants, list):
                dict_variants = [v for v in variants if isinstance(v, dict)]
                non_null = [v for v in dict_variants if v.get("type") != "null"]
                chosen = (
                    non_null[0]
                    if non_null
                    else (dict_variants[0] if dict_variants else {"type": "string"})
                )
                merged = {k: v for k, v in schema.items() if k not in ("anyOf", "oneOf")}
                for k, v in chosen.items():
                    merged.setdefault(k, v)
                return SafeOpenAI._sanitize_tool_schema(merged)

        result = {}
        for key, value in schema.items():
            # Drop keys that z.ai does not understand
            if key in ("strict", "additionalProperties"):
                continue
            # Remove empty required arrays
            if key == "required" and isinstance(value, list) and not value:
                continue
            # Recurse into nested dicts (properties, items, etc.)
            if isinstance(value, dict):
                value = SafeOpenAI._sanitize_tool_schema(value)
            elif isinstance(value, list):
                value = [
                    SafeOpenAI._sanitize_tool_schema(v)
                    if isinstance(v, dict)
                    else v
                    for v in value
                ]
            result[key] = value
        return result

    def _sanitize_tools(self, tools: list[dict] | None) -> list[dict] | None:
        """Sanitize a list of OpenAI-style tool dicts for z.ai/GLM.

        For every tool the function:
        1. Guarantees ``type: "function"`` wrapper is present.
        2. Strips ``strict``, ``additionalProperties``, empty ``required``.
        """
        if not tools:
            return tools

        sanitized = []
        for tool in tools:
            # Guarantee type wrapper exists
            if tool.get("type") != "function":
                # If the tool dict looks like a bare function description,
                # wrap it properly.
                if "function" not in tool and "name" in tool:
                    tool = {"type": "function", "function": tool}
                else:
                    tool = {**tool, "type": "function"}

            # Sanitize the function definition
            func = tool.get("function", {})
            func = self._sanitize_tool_schema(func)
            tool = {**tool, "function": func}
            sanitized.append(tool)

        return sanitized

    # ------------------------------------------------------------------
    # Message normalization
    # ------------------------------------------------------------------

    def _normalize_messages(self, messages: list[Message]) -> list[Message]:
        """Convert 'developer' to 'system', 'system' to 'user', filter out 'tool' role, and remove tool_calls."""
        normalized_messages = []
        developer_converted = 0
        system_converted = 0
        tool_filtered = 0
        tool_calls_removed = 0

        logger.info(
            "[SafeOpenAI] _normalize_messages processing %d messages",
            len(messages),
        )

        for i, msg in enumerate(messages):
            role = getattr(msg, "role", "unknown")
            content_preview = str(getattr(msg, "content", ""))[:50]
            has_tool_calls = hasattr(msg, "tool_calls") and msg.tool_calls is not None

            logger.debug(
                "[SafeOpenAI] Message %d: role='%s', content='%s...' has_tool_calls=%s",
                i,
                role,
                content_preview,
                has_tool_calls,
            )

            if msg.role == "developer":
                # Convert developer -> system -> user for APIs that don't support system
                new_msg = Message(
                    role="user",
                    content=f"System: {msg.content}",
                    **{
                        k: v
                        for k, v in msg.__dict__.items()
                        if k not in ["role", "content"]
                    },
                )
                normalized_messages.append(new_msg)
                developer_converted += 1
                logger.debug(
                    "[SafeOpenAI] Converted 'developer' to 'user' role (via system)"
                )
            elif msg.role == "system":
                # Convert system -> user for APIs that don't support system role
                new_msg = Message(
                    role="user",
                    content=f"System: {msg.content}",
                    **{
                        k: v
                        for k, v in msg.__dict__.items()
                        if k not in ["role", "content"]
                    },
                )
                normalized_messages.append(new_msg)
                system_converted += 1
                logger.debug("[SafeOpenAI] Converted 'system' to 'user' role")
            elif msg.role == "tool":
                # Don't filter tool messages - model needs tool results to avoid infinite loops
                normalized_messages.append(msg)
            elif msg.role == "assistant" and has_tool_calls:
                new_msg = Message(
                    role="assistant",
                    content=msg.content,
                    **{
                        k: v
                        for k, v in msg.__dict__.items()
                        if k not in ["role", "content", "tool_calls"]
                    },
                )
                normalized_messages.append(new_msg)
                tool_calls_removed += 1
                logger.info(
                    "[SafeOpenAI] Removed tool_calls from assistant message %d",
                    i,
                )
            else:
                normalized_messages.append(msg)

        if developer_converted > 0:
            logger.info(
                "[SafeOpenAI] Converted %d 'developer' -> 'user' messages",
                developer_converted,
            )

        if system_converted > 0:
            logger.info(
                "[SafeOpenAI] Converted %d 'system' -> 'user' messages",
                system_converted,
            )

        if tool_filtered > 0:
            logger.info(
                "[SafeOpenAI] Filtered out %d 'tool' role messages",
                tool_filtered,
            )

        if tool_calls_removed > 0:
            logger.info(
                "[SafeOpenAI] Removed tool_calls from %d assistant messages",
                tool_calls_removed,
            )

        if not normalized_messages:
            logger.warning(
                "[SafeOpenAI] All messages were filtered out. Returning original messages to avoid empty list."
            )
            return messages

        return normalized_messages

    def _format_tools(self, tools):
        """Override to fully sanitize tool schemas for z.ai/GLM.

        ``_format_tools`` is unconditionally on the request path (the base model
        formats tools here before invoke), so we run the full sanitizer — collapse
        ``anyOf``/``oneOf`` unions, strip ``strict`` / ``additionalProperties`` /
        empty ``required`` — to avoid ``400: Tool type cannot be empty`` (1214).
        """
        tool_dicts = super()._format_tools(tools)
        return self._sanitize_tools(tool_dicts)

    def invoke(self, messages: list[Message], *args, **kwargs) -> ModelResponse:
        logger.info("[SafeOpenAI] invoke() called with %d messages", len(messages))
        normalized = self._normalize_messages(messages)
        if "tools" in kwargs:
            kwargs["tools"] = self._sanitize_tools(kwargs["tools"])
        logger.info(
            "[SafeOpenAI] invoke() passing %d messages to super()", len(normalized)
        )
        return super().invoke(normalized, *args, **kwargs)

    async def ainvoke(self, messages: list[Message], *args, **kwargs) -> ModelResponse:
        logger.info("[SafeOpenAI] ainvoke() called with %d messages", len(messages))
        normalized = self._normalize_messages(messages)
        if "tools" in kwargs:
            kwargs["tools"] = self._sanitize_tools(kwargs["tools"])
        logger.info(
            "[SafeOpenAI] ainvoke() passing %d messages to super()", len(normalized)
        )
        return await super().ainvoke(normalized, *args, **kwargs)

    def invoke_stream(self, messages: list[Message], *args, **kwargs):
        logger.info(
            "[SafeOpenAI] invoke_stream() called with %d messages", len(messages)
        )
        normalized = self._normalize_messages(messages)
        if "tools" in kwargs:
            kwargs["tools"] = self._sanitize_tools(kwargs["tools"])
        logger.info(
            "[SafeOpenAI] invoke_stream() passing %d messages to super()",
            len(normalized),
        )
        yield from super().invoke_stream(normalized, *args, **kwargs)

    async def ainvoke_stream(self, messages: list[Message], *args, **kwargs):
        logger.info(
            "[SafeOpenAI] ainvoke_stream() called with %d messages", len(messages)
        )
        normalized = self._normalize_messages(messages)
        if "tools" in kwargs:
            kwargs["tools"] = self._sanitize_tools(kwargs["tools"])
        logger.info(
            "[SafeOpenAI] ainvoke_stream() passing %d messages to super()",
            len(normalized),
        )
        async for response in super().ainvoke_stream(normalized, *args, **kwargs):
            yield response
