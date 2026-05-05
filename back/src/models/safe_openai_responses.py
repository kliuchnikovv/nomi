"""
SafeOpenAIResponses wrapper for the OpenAI Responses API.

Two problems are handled here:

1. Tool call ID remapping
   When sessions are reused across model switches (e.g., from z.ai GLM to gpt-5-nano),
   the stored tool call IDs may be plain UUIDs instead of the "fc_"-prefixed IDs that
   the Responses API requires. This wrapper remaps any non-compliant IDs before the
   request is built, preventing the "Expected an ID that begins with 'fc'" 400 error.

   IDs that already use a recognised prefix ("fc_", "call_") are left unchanged so that
   Agno's fc_id_to_call_id lookup can resolve them correctly.

2. Unsupported request parameters
   agno's OpenAIResponses always injects "reasoning": {} and, for reasoning models
   (including gpt-5-*), "store": true.  OpenCode's Responses API does not support
   these fields and returns 400 Bad Request.  This wrapper strips them in
   get_request_params() while intentionally preserving every other reasoning-model
   behaviour — in particular the "previous_response_id" continuation mechanism and
   the corresponding _format_messages() history truncation.

   Keeping previous_response_id is critical: when the model produces a reasoning item
   (rs_...) alongside a function_call (fc_...), the second request (after tool execution)
   must NOT re-send the function_call, because the API then requires the accompanying
   reasoning item too.  By using previous_response_id, agno truncates the history to
   only the messages that came *after* the previous response, so the function_call is
   never re-sent and the "function_call without its required reasoning item" 400 error
   is avoided entirely.

   NOTE: _using_reasoning_model() is intentionally NOT overridden so that agno's
   previous_response_id / history-truncation logic is active for gpt-5-* models.
"""

import logging
from typing import Any, Dict, List, Union

from agno.models.openai import OpenAIResponses
from agno.models.message import Message

logger = logging.getLogger(__name__)


class SafeOpenAIResponses(OpenAIResponses):
    """
    OpenAI Responses API wrapper that:
    - Normalises tool call IDs to the required "fc_" prefix (plain UUIDs only).
    - Strips "reasoning: {}" and "store: true" params unsupported by OpenCode while
      preserving previous_response_id / history-truncation behaviour.
    """

    # ── Request parameter sanitisation ───────────────────────────────────────

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
        if "store" in params and self.store is None:
            del params["store"]
        return params

    # ── Tool call ID remapping ────────────────────────────────────────────────

    def _remap_tool_call_ids(self, messages: List[Message]) -> None:
        """Mutate messages in-place, adding 'fc_' prefix to any tool call ID that lacks it.

        Only plain UUIDs (no recognised prefix) are remapped. IDs already using a standard
        prefix — 'fc_' (Responses API), 'call_' (OpenCode / Chat Completions) — are left
        unchanged so Agno's fc_id_to_call_id lookup can resolve them correctly.
        """
        for msg in messages:
            # Assistant messages with tool_calls
            if msg.tool_calls:
                for tc in msg.tool_calls:
                    if isinstance(tc, dict) and isinstance(tc.get("id"), str):
                        if not tc["id"].startswith("fc") and not tc["id"].startswith("call_"):
                            original = tc["id"]
                            tc["id"] = "fc_" + original
                            logger.debug(
                                "[SafeOpenAIResponses] Remapped tool_call id %s -> %s",
                                original,
                                tc["id"],
                            )
            # Tool result messages
            if (
                isinstance(msg.tool_call_id, str)
                and not msg.tool_call_id.startswith("fc")
                and not msg.tool_call_id.startswith("call_")
            ):
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
