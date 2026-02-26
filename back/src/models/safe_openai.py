"""
SafeOpenAI wrapper that converts 'developer' role to 'system' for GLM models.

The OpenAI API (and some OpenAI-compatible APIs like GLM) use 'developer' role
for system instructions, but GLM models reject this with "Incorrect role information".
This wrapper converts 'developer' to 'system' before sending to API.
"""

import logging

from agno.models.openai import OpenAIChat
from agno.models.message import Message
from agno.models.response import ModelResponse

logger = logging.getLogger(__name__)


class SafeOpenAI(OpenAIChat):
    """
    An OpenAI-compatible model wrapper that converts 'developer' role to 'system'
    for APIs that don't support the 'developer' role (e.g., GLM models).
    """

    def _convert_developer_to_system(self, messages: list[Message]) -> list[Message]:
        """Convert all 'developer' roles to 'system' to avoid API rejections."""
        converted_messages = []
        converted_count = 0

        for msg in messages:
            if msg.role == "developer":
                # Create new message with 'system' role
                new_msg = Message(
                    role="system",
                    content=msg.content,
                    **{
                        k: v
                        for k, v in msg.__dict__.items()
                        if k not in ["role", "content"]
                    },
                )
                converted_messages.append(new_msg)
                converted_count += 1
                logger.debug(
                    "[SafeOpenAI] Converted 'developer' to 'system' role"
                )
            else:
                converted_messages.append(msg)

        if converted_count > 0:
            logger.info(
                "[SafeOpenAI] Converted %d 'developer' -> 'system' messages",
                converted_count,
            )

        return converted_messages

    def invoke(self, messages: list[Message], *args, **kwargs) -> ModelResponse:
        """Override invoke to convert developer roles before calling parent."""
        converted = self._convert_developer_to_system(messages)
        return super().invoke(converted, *args, **kwargs)

    async def ainvoke(self, messages: list[Message], *args, **kwargs) -> ModelResponse:
        """Override ainvoke to convert developer roles before calling parent."""
        converted = self._convert_developer_to_system(messages)
        return await super().ainvoke(converted, *args, **kwargs)

    def invoke_stream(self, messages: list[Message], *args, **kwargs) -> ModelResponse:
        """Override invoke_stream to convert developer roles before calling parent."""
        converted = self._convert_developer_to_system(messages)
        return super().invoke_stream(converted, *args, **kwargs)

    async def ainvoke_stream(self, messages: list[Message], *args, **kwargs):
        """Override ainvoke_stream to convert developer roles before calling parent."""
        converted = self._convert_developer_to_system(messages)
        async for response in super().ainvoke_stream(converted, *args, **kwargs):
            yield response
