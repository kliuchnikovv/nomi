"""
SafeOpenAIResponses wrapper for the OpenAI Responses API.

Three problems are handled here:

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

3. Missing reasoning items for function_call history
   When history contains assistant messages that have BOTH tool_calls AND a stored
   reasoning_output in provider_data (produced by a ZDR/reasoning model session), agno's
   _format_messages puts the message through the `elif tool_calls` branch which emits
   the function_call items but never emits the accompanying ResponseReasoningItem.  The
   Responses API then rejects the request with:
       "function_call was provided without its required 'reasoning' item"
   This wrapper post-processes the formatted list to inject any missing reasoning items
   immediately before their corresponding function_call items.
"""

import logging
from typing import Any, Dict, List, Union

from agno.models.openai import OpenAIResponses
from agno.models.message import Message

try:
    from openai.types.responses import ResponseReasoningItem
except ImportError:
    ResponseReasoningItem = None  # type: ignore[assignment,misc]

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
        formatted = list(super()._format_messages(messages, compress_tool_results))
        self._inject_missing_reasoning_items(messages, formatted)
        return formatted

    def _inject_missing_reasoning_items(
        self,
        messages: List[Message],
        formatted: List[Union[Dict[str, Any], Any]],
    ) -> None:
        """Insert reasoning items that agno silently dropped for tool-call messages.

        agno's _format_messages has two mutually-exclusive branches for assistant
        messages: the `elif tool_calls` branch (emits function_call items only) and
        the `else` branch (emits text content + ResponseReasoningItem when store=False).
        Messages with *both* tool_calls and a stored reasoning_output therefore lose
        their reasoning item, causing the Responses API to reject the request.

        This method scans every such message and inserts the ResponseReasoningItem
        immediately before the first function_call item that belongs to it.
        """
        if ResponseReasoningItem is None:
            return

        for msg in messages:
            if not (
                msg.tool_calls
                and hasattr(msg, "provider_data")
                and msg.provider_data
                and msg.provider_data.get("reasoning_output") is not None
            ):
                continue

            try:
                reasoning_item = ResponseReasoningItem.model_validate(
                    msg.provider_data["reasoning_output"]
                )
            except Exception as exc:
                logger.warning(
                    "[SafeOpenAIResponses] Could not parse reasoning_output: %s", exc
                )
                continue

            # Skip if this reasoning item is already present (idempotency).
            already_present = any(
                isinstance(item, ResponseReasoningItem)
                and getattr(item, "id", None) == getattr(reasoning_item, "id", None)
                for item in formatted
            )
            if already_present:
                continue

            # Find the position of the first function_call item that belongs to
            # this message (identified by matching tool-call IDs).
            tc_ids = {
                tc.get("id")
                for tc in msg.tool_calls
                if isinstance(tc, dict) and tc.get("id")
            }
            insert_pos: int | None = None
            for i, item in enumerate(formatted):
                if (
                    isinstance(item, dict)
                    and item.get("type") == "function_call"
                    and item.get("id") in tc_ids
                ):
                    insert_pos = i
                    break

            if insert_pos is not None:
                formatted.insert(insert_pos, reasoning_item)
                logger.debug(
                    "[SafeOpenAIResponses] Injected reasoning item %s before function_call at index %d",
                    getattr(reasoning_item, "id", "?"),
                    insert_pos,
                )
