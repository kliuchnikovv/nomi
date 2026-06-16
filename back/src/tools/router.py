from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

ROUTER_MODEL = "gemini-2.5-flash-lite"

# Valid JSON string escapes per the spec; any other char after a backslash is an
# illegal escape that crashes json.loads. The model sometimes echoes user text
# (e.g. a path like "\workspace") verbatim into a JSON string value.
_VALID_JSON_ESCAPES = set('"\\/bfnrtu')


def _repair_json_escapes(text: str) -> str:
    """Escape stray backslashes that aren't part of a valid JSON escape.

    Turns an illegal ``\\w`` (as in ``"\\workspace"``) into ``\\\\w`` so the
    string parses, leaving valid escapes (``\\n``, ``\\"``, ``\\uXXXX``, ...)
    untouched.
    """
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "\\" and i + 1 < n:
            nxt = text[i + 1]
            if nxt in _VALID_JSON_ESCAPES:
                out.append(ch)
                out.append(nxt)
                i += 2
                continue
            # Illegal escape: double the backslash so it becomes a literal.
            out.append("\\\\")
            i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _parse_router_json(text: str) -> Any:
    """Best-effort parse of the router model's JSON response.

    Strips markdown code fences, then tries json.loads; on an escape error,
    repairs stray backslashes and retries once.
    """
    s = (text or "").strip()
    if s.startswith("```"):
        # Drop the opening fence (``` or ```json) and the trailing fence.
        s = s.split("\n", 1)[1] if "\n" in s else s.lstrip("`")
        if s.endswith("```"):
            s = s[: s.rfind("```")]
        s = s.strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return json.loads(_repair_json_escapes(s))

SYSTEM_PROMPT = """\
You are a tool router. Given a user request and a list of available tools,
decide which tool and method to call.

The available tools span many domains — email, calendar, reminders, contacts,
health & fitness (steps, sleep, heart rate, workouts), code, and web. Always
match the request against the provided tool/method schemas; never assume a
request is unsupported just because it is not email or calendar related.

Rules:
1. If the request clearly maps to one tool and method → action: "execute"
2. If it is a WRITE operation (send, create, delete, update) and the tool has 2+
    accounts → action: "question" asking which account to use
3. If it is a READ operation and 2+ accounts exist:
    - If the request contains "each" "every" "all" "every" "все" "каждый" "во всех" "по всем"  # Russian: all, each, in all, across all
      or similar phrasing indicating ALL accounts → account_id: "*"
    - Otherwise, try to infer from the request or context; if unclear → action: "question"
4. If the request asks for general knowledge, current events, news, weather, prices,
    or any external fact NOT covered by a more specific tool, AND a web search tool
    (e.g. "web_search") is available → route to it (action: "execute"). Never answer
    "none" for an answerable factual/current-info question when web search exists.
5. If no tool matches the request and no web search tool is available → action: "none"
6. For action "execute", always include: tool, method, account_id (empty string if
    no accounts, "*" for all accounts), params (JSON object matching the method's parameter schema)

Examples:
- "What emails are in my Gmail?" (1 account) → account_id: ""
- "What emails are in my Gmail accounts?" (2+ accounts, unclear which) → action: "question"
- "What are the recent emails in each Gmail account?" (2+ accounts, "each") → account_id: "*"
- "Show me all my Gmail emails across all accounts" (2+ accounts, "all") → account_id: "*"
- "Send email to bob@example.com" (1 account) → account_id: ""
- "Send email to bob@example.com" (2+ accounts, WRITE) → action: "question"
- "How did I sleep last night?" → tool: ios_health, method: get_sleep_analysis
- "How many steps did I take today?" → tool: ios_health, method: get_steps
- "What's the weather today?" (web_search available) → tool: web_search, method: duckduckgo_search, params: {"query": "weather today"}
- "Who won the game last night?" (web_search available) → tool: web_search, method: duckduckgo_search

Return valid JSON only, no markdown fences.

Response schema:
{
  "action": "execute" | "question" | "none",
  "tool": "<tool name or empty>",
  "method": "<method name or empty>",
  "account_id": "<account id or empty or * for all accounts>",
  "params": {},
  "question": "<question text if action is question>",
  "options": ["<option 1>", ...]
}
"""


@dataclass
class RoutingDecision:
    action: str  # "execute" | "question" | "none"
    tool: str = ""
    method: str = ""
    account_id: str = ""
    params: dict[str, Any] = field(default_factory=dict)
    question: str = ""
    options: list[str] = field(default_factory=list)


class ToolRouter:
    def __init__(self, api_key: str | None = None):
        self._explicit_key = api_key
        self._client = genai.Client(api_key=self._current_key())
        self._system_prompt = SYSTEM_PROMPT
        self._model_name = ROUTER_MODEL

    def _current_key(self) -> str | None:
        """Explicit key wins; else current pooled key, or None if none configured
        (deferring failure to the API call, as before key rotation existed)."""
        if self._explicit_key:
            return self._explicit_key
        from src.core.gemini_keys import KEY_MANAGER

        return KEY_MANAGER.current() if KEY_MANAGER.count else None

    def _rebuild_client(self) -> None:
        self._client = genai.Client(api_key=self._current_key())

    def _generate_with_rotation(self, prompt: str):
        """Call Gemini; on a quota error rotate the key once and retry."""
        from src.core.gemini_keys import KEY_MANAGER, is_quota_error

        cfg = types.GenerateContentConfig(
            system_instruction=self._system_prompt,
            temperature=0,
            response_mime_type="application/json",
        )
        try:
            return self._client.models.generate_content(
                model=self._model_name, contents=prompt, config=cfg
            )
        except Exception as e:
            if (
                self._explicit_key is None
                and is_quota_error(e)
                and KEY_MANAGER.count > 1
            ):
                KEY_MANAGER.rotate("router ResourceExhausted")
                self._rebuild_client()
                return self._client.models.generate_content(
                    model=self._model_name, contents=prompt, config=cfg
                )
            raise

    def decide(
        self,
        request: str,
        context: str,
        tools: list[dict[str, Any]],
    ) -> RoutingDecision:
        tools_text = json.dumps(tools, ensure_ascii=False, indent=2)
        prompt_parts = [
            f"Available tools:\n{tools_text}",
            f"User request: {request}",
        ]
        if context:
            prompt_parts.append(f"Additional context: {context}")

        prompt = "\n\n".join(prompt_parts)

        try:
            response = self._generate_with_rotation(prompt)
            raw = _parse_router_json(response.text)

            # Handle list responses - use first element if valid
            if isinstance(raw, list) and len(raw) > 0 and isinstance(raw[0], dict):
                logger.info("[Router] Received list, using first element")
                raw = raw[0]

            if not isinstance(raw, dict):
                logger.warning(
                    "[Router] Unexpected response type %s, expected dict. Response: %s",
                    type(raw).__name__,
                    response.text[:200]
                    if hasattr(response, "text")
                    else str(raw)[:200],
                )
                return RoutingDecision(action="none")
        except Exception as e:
            logger.warning(
                "[Router] Failed to get routing decision: %s", e, exc_info=True
            )
            return RoutingDecision(action="none")

        return RoutingDecision(
            action=raw.get("action", "none"),
            tool=raw.get("tool", ""),
            method=raw.get("method", ""),
            account_id=raw.get("account_id", ""),
            params=raw.get("params") if isinstance(raw.get("params"), dict) else {},
            question=raw.get("question", ""),
            options=raw.get("options") if isinstance(raw.get("options"), list) else [],
        )
