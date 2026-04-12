"""
SafeOpenAIResponses wrapper for the OpenAI Responses API.

When sessions are reused across model switches (e.g., from z.ai GLM to gpt-5-nano),
the stored tool call IDs may be plain UUIDs instead of the "fc_"-prefixed IDs that
the Responses API requires. This wrapper remaps any non-compliant IDs before the
request is built, preventing the "Expected an ID that begins with 'fc'" 400 error.
"""

import logging
from typing import Any, Dict, List, Union

from agno.models.openai import OpenAIResponses
from agno.models.message import Message

logger = logging.getLogger(__name__)


class SafeOpenAIResponses(OpenAIResponses):
    """
    OpenAI Responses API wrapper that normalises tool call IDs.

    The Responses API requires all function_call `id` values to start with "fc".
    When Agno replays a session that was previously driven by a Chat Completions
    model (e.g., z.ai GLM), the stored tool call IDs are plain UUIDs. This class
    remaps them in-place before calling the parent formatter so the API never sees
    a non-compliant ID.
    """

    def _remap_tool_call_ids(self, messages: List[Message]) -> None:
        """Mutate messages in-place, adding 'fc_' prefix to any tool call ID that lacks it."""
        for msg in messages:
            # Assistant messages with tool_calls
            if msg.tool_calls:
                for tc in msg.tool_calls:
                    if isinstance(tc, dict) and isinstance(tc.get("id"), str):
                        if not tc["id"].startswith("fc"):
                            original = tc["id"]
                            tc["id"] = "fc_" + original
                            logger.debug(
                                "[SafeOpenAIResponses] Remapped tool_call id %s -> %s",
                                original,
                                tc["id"],
                            )
            # Tool result messages
            if isinstance(msg.tool_call_id, str) and not msg.tool_call_id.startswith("fc"):
                original = msg.tool_call_id
                msg.tool_call_id = "fc_" + original
                logger.debug(
                    "[SafeOpenAIResponses] Remapped tool_call_id %s -> %s",
                    original,
                    msg.tool_call_id,
                )

    def _format_messages(
        self, messages: List[Message], compress_tool_results: bool = False
    ) -> List[Union[Dict[str, Any], Any]]:
        self._remap_tool_call_ids(messages)
        return super()._format_messages(messages, compress_tool_results)
