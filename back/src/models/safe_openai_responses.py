"""
SafeOpenAIResponses wrapper for the OpenAI Responses API.

Two problems are handled here:

1. Tool call ID remapping
   When sessions are reused across model switches (e.g., from z.ai GLM to gpt-5-nano),
   the stored tool call IDs may be plain UUIDs instead of the "fc_"-prefixed IDs that
   the Responses API requires. This wrapper remaps any non-compliant IDs before the
   request is built, preventing the "Expected an ID that begins with 'fc'" 400 error.

2. Unsupported reasoning parameters
   agno's OpenAIResponses treats any model whose ID starts with "gpt-5" as a reasoning
   model, which causes it to send "reasoning": {} and "store": true in every request.
   OpenCode's Responses API (and most OpenAI-compatible providers) do not support these
   parameters and return 400 Bad Request. This wrapper suppresses that behaviour by
   overriding _using_reasoning_model() to return False and strips the empty "reasoning"
   dict from outgoing request params.
"""

import logging
from typing import Any, Dict, List, Union

from agno.models.openai import OpenAIResponses
from agno.models.message import Message

logger = logging.getLogger(__name__)


class SafeOpenAIResponses(OpenAIResponses):
    """
    OpenAI Responses API wrapper that:
    - Normalises tool call IDs to the required "fc_" prefix.
    - Suppresses reasoning-model-specific parameters unsupported by OpenCode.
    """

    # ── Reasoning model behaviour ─────────────────────────────────────────────

    def _using_reasoning_model(self) -> bool:
        """Always return False so agno does not inject store/reasoning params.

        agno defaults to treating any model whose ID starts with "gpt-5" as a
        reasoning model and sends `store: true` plus `reasoning: {}`. OpenCode's
        Responses API does not support these fields.
        """
        return False

    def get_request_params(
        self,
        messages=None,
        response_format=None,
        tools=None,
        tool_choice=None,
    ) -> Dict[str, Any]:
        params = super().get_request_params(
            messages=messages,
            response_format=response_format,
            tools=tools,
            tool_choice=tool_choice,
        )
        # Strip "reasoning" if it is empty (agno always injects {} when unset).
        if params.get("reasoning") == {}:
            del params["reasoning"]
            logger.debug("[SafeOpenAIResponses] Removed empty 'reasoning' param")
        # Strip "store" unless the caller explicitly configured it.
        if "store" in params and self.store is None:
            del params["store"]
            logger.debug("[SafeOpenAIResponses] Removed auto-injected 'store' param")
        return params

    # ── Tool call ID remapping ────────────────────────────────────────────────

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
