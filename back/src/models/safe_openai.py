"""
SafeOpenAI wrapper that converts 'developer' role to 'system' for GLM models.

The OpenAI API (and some OpenAI-compatible APIs like GLM) use 'developer' role
for system instructions, but GLM models reject this with "Incorrect role information".
This wrapper converts 'developer' to 'system' before sending to API.

Additionally, GLM models don't support 'tool' role messages, so we filter those out
while preserving assistant messages with tool_calls.
"""

import logging

from agno.models.openai import OpenAIChat
from agno.models.message import Message
from agno.models.response import ModelResponse

logger = logging.getLogger(__name__)


class SafeOpenAI(OpenAIChat):
    """
    An OpenAI-compatible model wrapper that converts 'developer' role to 'system'
    and filters out 'tool' role messages for APIs that don't support these roles
    (e.g., GLM models).
    """

    def _normalize_messages(self, messages: list[Message]) -> list[Message]:
        """Convert 'developer' to 'system' and filter out 'tool' role messages."""
        normalized_messages = []
        developer_converted = 0
        tool_filtered = 0

        for msg in messages:
            if msg.role == "developer":
                new_msg = Message(
                    role="system",
                    content=msg.content,
                    **{
                        k: v
                        for k, v in msg.__dict__.items()
                        if k not in ["role", "content"]
                    },
                )
                normalized_messages.append(new_msg)
                developer_converted += 1
                logger.debug("[SafeOpenAI] Converted 'developer' to 'system' role")
            elif msg.role == "tool":
                tool_filtered += 1
                logger.debug(
                    "[SafeOpenAI] Filtered out 'tool' role message (tool_call_id=%s)",
                    getattr(msg, "tool_call_id", "unknown"),
                )
            else:
                normalized_messages.append(msg)

        if developer_converted > 0:
            logger.info(
                "[SafeOpenAI] Converted %d 'developer' -> 'system' messages",
                developer_converted,
            )

        if tool_filtered > 0:
            logger.info(
                "[SafeOpenAI] Filtered out %d 'tool' role messages",
                tool_filtered,
            )

        if not normalized_messages:
            logger.warning(
                "[SafeOpenAI] All messages were filtered out. Returning original messages to avoid empty list."
            )
            return messages

        return normalized_messages

    def invoke(self, messages: list[Message], *args, **kwargs) -> ModelResponse:
        normalized = self._normalize_messages(messages)
        return super().invoke(normalized, *args, **kwargs)

    async def ainvoke(self, messages: list[Message], *args, **kwargs) -> ModelResponse:
        normalized = self._normalize_messages(messages)
        return await super().ainvoke(normalized, *args, **kwargs)

    def invoke_stream(self, messages: list[Message], *args, **kwargs):
        normalized = self._normalize_messages(messages)
        yield from super().invoke_stream(normalized, *args, **kwargs)

    async def ainvoke_stream(self, messages: list[Message], *args, **kwargs):
        normalized = self._normalize_messages(messages)
        async for response in super().ainvoke_stream(normalized, *args, **kwargs):
            yield response
