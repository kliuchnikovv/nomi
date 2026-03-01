from __future__ import annotations

import json
import logging
from typing import Any, Callable

from agno.tools import Function

from src.tools.config import ToolConfigClient
from src.tools.executor import ServerToolExecutor
from src.tools.registry import ToolRegistry
from src.tools.router import ToolRouter

logger = logging.getLogger(__name__)


def build_discovery_tool(
    user_id: str,
    config_client: ToolConfigClient,
    client_tool_runner: Callable | None = None,
    *,
    router: ToolRouter | None = None,
    executor: ServerToolExecutor | None = None,
) -> Function:
    """
    Build the discovery_tool Agno Function for a given user session.
    Pass router/executor only in tests to inject mocks.
    """
    _router = router or ToolRouter()
    _executor = executor or ServerToolExecutor()

    async def _discovery_tool(request: str, context: str = "") -> str:
        """
        Execute any available action by describing it in natural language.

        Use this tool whenever you need to interact with external services
        (email, calendar, GitHub, web search, etc.). Describe what you want
        to do in plain language. If the tool needs clarification (e.g., which
        account to use), it will return a question — pass it to the user and
        call this tool again with the answer in `context`.

        Args:
            request: Natural language description of the action to perform.
            context: Optional additional context (e.g., "use work@gmail.com").

        Returns:
            JSON string: {"type": "result", "result": "..."}
                      or {"type": "question", "question": "...", "options": [...]}
                      or {"type": "error", "error": "..."}
        """
        try:
            tools_config = await config_client.fetch_tools(user_id=user_id)
        except Exception:
            logger.warning("[Discovery] Failed to fetch tools for user=%s", user_id, exc_info=True)
            return json.dumps({"type": "error", "error": "Failed to load integrations"})

        schemas = ToolRegistry.build(tools_config)
        if not schemas:
            return json.dumps({"type": "error", "error": "No integrations connected"})

        try:
            decision = _router.decide(request, context, schemas)
        except Exception:
            logger.warning("[Discovery] Router failed for user=%s", user_id, exc_info=True)
            return json.dumps({"type": "error", "error": "Failed to route request"})

        if decision.action == "question":
            return json.dumps({
                "type": "question",
                "question": decision.question,
                "options": decision.options,
            })

        if decision.action == "none":
            return json.dumps({"type": "error", "error": f"No tool found for: {request}"})

        tool_schema = next((s for s in schemas if s["name"] == decision.tool), None)
        if not tool_schema:
            return json.dumps({"type": "error", "error": f"Unknown tool: {decision.tool}"})

        # Client-execution path (iOS-native: Calendar, Reminders) and hybrid tools (Gmail, etc.)
        if tool_schema.get("execution") in ("client", "hybrid"):
            if tool_schema.get("execution") == "client" and not client_tool_runner:
                return json.dumps({"type": "error", "error": "Client tool runner not configured"})
            if client_tool_runner:
                try:
                    result = await client_tool_runner(decision.tool, decision.method, decision.params)
                    return json.dumps({"type": "result", "result": result})
                except Exception:
                    logger.warning(
                        "[Discovery] Client tool error: tool=%s method=%s",
                        decision.tool,
                        decision.method,
                        exc_info=True,
                    )
                    return json.dumps({"type": "error", "error": "Client tool execution failed"})
            # hybrid with no runner: fall through to server execution below

        # Server-execution path
        entry = tools_config.entries.get(decision.tool)
        credentials: dict[str, Any] = {}
        if entry:
            if decision.account_id:
                creds_map = (
                    entry.params.get("credentials")
                    if isinstance(entry.params.get("credentials"), dict)
                    else {}
                )
                credentials = creds_map.get(decision.account_id) or entry.params
                logger.debug("[Discovery] Using credentials for account_id=%s, found=%s", decision.account_id, bool(creds_map.get(decision.account_id)))
            else:
                credentials = entry.params
                logger.debug("[Discovery] No account_id, using entry.params directly")

            logger.debug("[Discovery] entry.params keys: %s", list(entry.params.keys()))
            logger.debug("[Discovery] credentials keys: %s", list(credentials.keys()) if isinstance(credentials, dict) else "not a dict")
            logger.debug("[Discovery] Has access_token: %s", bool(credentials.get("access_token") or credentials.get("token")))

        try:
            result = _executor.run(decision.tool, decision.method, decision.params, credentials)
            return json.dumps({"type": "result", "result": result})
        except Exception:
            logger.warning(
                "[Discovery] Server tool error: tool=%s method=%s",
                decision.tool,
                decision.method,
                exc_info=True,
            )
            return json.dumps({"type": "error", "error": "Tool execution failed"})

    return Function(
        name="discovery_tool",
        description=(
            "Execute any available action (send email, search GitHub, look up calendar events, "
            "search the web, etc.) by describing what you need in natural language. "
            "Returns result, a clarifying question, or an error."
        ),
        parameters={
            "type": "object",
            "properties": {
                "request": {
                    "type": "string",
                    "description": "Natural language description of what to do",
                },
                "context": {
                    "type": "string",
                    "description": "Additional context, e.g. which account to use",
                },
            },
            "required": ["request"],
        },
        entrypoint=_discovery_tool,
    )
