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
    before_sleep_log,
)
import google.api_core.exceptions

logger = logging.getLogger(__name__)


class SafeGemini(Gemini):
    """
    A Gemini model wrapper that filters out empty parts from messages
    before sending them to API, preventing 400 INVALID_ARGUMENT errors.

    Also supports native Gemini 2.5 thinking/reasoning via thinking_budget
    and include_thoughts parameters (compatible with function calling).
    """

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
        """
        Filter out messages with empty parts or empty content.
        """
        filtered_messages = []

        for msg in messages:
            # DEBUG: Log tool messages to find application/json issue
            if msg.role == "tool":
                logger.info(
                    f"[SafeGemini DEBUG] Tool Message: content_type={type(msg.content)} content={msg.content}"
                )
                if isinstance(msg.content, list):
                    for i, part in enumerate(msg.content):
                        logger.info(f"[SafeGemini DEBUG] Part {i}: {part}")

            # Check if message has content
            if msg.content is None:
                # Skip messages with no content at all
                logger.debug("[SafeGemini] Skipping message with None content")
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
            for msg in messages:
                if msg.role in ("user", "system") and msg.content is not None:
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
        before_sleep=before_sleep_log(logger, logging.WARNING),
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
        before_sleep=before_sleep_log(logger, logging.WARNING),
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
        before_sleep=before_sleep_log(logger, logging.WARNING),
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
        before_sleep=before_sleep_log(logger, logging.WARNING),
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
