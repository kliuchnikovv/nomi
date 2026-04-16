from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

ROUTER_MODEL = "gemini-2.0-flash-lite"

SYSTEM_PROMPT = """\
You are a tool router. Given a user request and a list of available tools,
decide which tool and method to call.

Rules:
1. If the request clearly maps to one tool and method → action: "execute"
2. If it is a WRITE operation (send, create, delete, update) and the tool has 2+
    accounts → action: "question" asking which account to use
3. If it is a READ operation and 2+ accounts exist:
    - If the request contains "each" "every" "all" "every" "все" "каждый" "во всех" "по всем"  # Russian: all, each, in all, across all
      or similar phrasing indicating ALL accounts → account_id: "*"
    - Otherwise, try to infer from the request or context; if unclear → action: "question"
4. If no tool matches the request → action: "none"
5. For action "execute", always include: tool, method, account_id (empty string if
    no accounts, "*" for all accounts), params (JSON object matching the method's parameter schema)

Examples:
- "What emails are in my Gmail?" (1 account) → account_id: ""
- "What emails are in my Gmail accounts?" (2+ accounts, unclear which) → action: "question"
- "What are the recent emails in each Gmail account?" (2+ accounts, "each") → account_id: "*"
- "Show me all my Gmail emails across all accounts" (2+ accounts, "all") → account_id: "*"
- "Send email to bob@example.com" (1 account) → account_id: ""
- "Send email to bob@example.com" (2+ accounts, WRITE) → action: "question"

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
        key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        self._client = genai.Client(api_key=key)
        self._system_prompt = SYSTEM_PROMPT
        self._model_name = ROUTER_MODEL

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
            response = self._client.models.generate_content(
                model=self._model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=self._system_prompt,
                    temperature=0,
                    response_mime_type="application/json",
                ),
            )
            raw = json.loads(response.text)

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
