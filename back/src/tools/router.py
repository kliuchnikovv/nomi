from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any

import google.generativeai as genai

logger = logging.getLogger(__name__)

ROUTER_MODEL = "gemini-2.0-flash-lite"

SYSTEM_PROMPT = """\
You are a tool router. Given a user request and a list of available tools,
decide which tool and method to call.

Rules:
1. If the request clearly maps to one tool and method → action: "execute"
2. If it is a WRITE operation (send, create, delete, update) and the tool has 2+
   accounts → action: "question" asking which account to use
3. If it is a READ operation and 2+ accounts exist → try to infer from the request
   or context; if unclear → action: "question"
4. If no tool matches the request → action: "none"
5. For action "execute", always include: tool, method, account_id (empty string if
   no accounts), params (JSON object matching the method's parameter schema)

Return valid JSON only, no markdown fences.

Response schema:
{
  "action": "execute" | "question" | "none",
  "tool": "<tool name or empty>",
  "method": "<method name or empty>",
  "account_id": "<account id or empty>",
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
        genai.configure(api_key=key)
        self._model = genai.GenerativeModel(
            model_name=ROUTER_MODEL,
            system_instruction=SYSTEM_PROMPT,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                temperature=0,
            ),
        )

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
            response = self._model.generate_content(prompt)
            raw = json.loads(response.text)
        except Exception:
            logger.warning("[Router] Failed to get routing decision", exc_info=True)
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
