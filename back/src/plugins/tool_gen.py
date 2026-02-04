"""
Generate tool definitions for the LLM from plugin manifests.
Manifest methods -> tool definitions; client plugins use generic proxy (send_and_wait).
"""

import logging
from typing import Any, Callable, Awaitable

from agno.tools import Function

logger = logging.getLogger(__name__)


def _build_parameters_schema(params: list[dict[str, Any]]) -> dict[str, Any]:
    """Build JSON Schema for tool parameters from manifest params."""
    properties = {}
    required = []
    for p in params or []:
        name = p.get("name")
        if not name:
            continue
        prop = {
            "type": p.get("type", "string"),
            "description": p.get("description", ""),
        }
        if "default" in p:
            prop["default"] = p["default"]
        properties[name] = prop
        if p.get("required", True):
            required.append(name)
    return {"type": "object", "properties": properties, "required": required}


def build_client_proxy_tools(
    manifests: list[dict[str, Any]],
    client_runner: Callable[[str, str, dict[str, Any]], Awaitable[str]],
) -> list[Function]:
    """
    Build Function tools for client-only plugins from manifests.
    Each method becomes a tool; when called, runner(plugin, method, params) is awaited.
    """
    tools: list[Function] = []
    for manifest in manifests:
        name = manifest.get("name") or ""
        execution = manifest.get("execution") or {}
        if execution.get("type") != "client":
            continue
        methods = manifest.get("methods") or []
        for m in methods:
            method_name = m.get("name")
            if not method_name:
                continue
            tool_name = f"{name}_{method_name}"
            description = (
                m.get("description")
                or f"Call {name}.{method_name} on the user's device"
            )
            params_schema = _build_parameters_schema(m.get("params") or [])

            def _make_proxy(plugin: str, method: str, runner: Any):
                async def _proxy(**kwargs: Any) -> str:
                    logger.error(
                        "[ClientProxyTool] Calling %s.%s with params: %s",
                        plugin,
                        method,
                        kwargs,
                    )
                    try:
                        result = await runner(plugin, method, kwargs)
                        if result is None:
                            logger.error(
                                "[ClientProxyTool] %s.%s returned None!", plugin, method
                            )
                            return "Error: Tool execution returned None"

                        logger.error(
                            "[ClientProxyTool] %s.%s returned: %s",
                            plugin,
                            method,
                            result[:100] if result else result,
                        )
                        return result
                    except Exception as e:
                        logger.error(
                            "[ClientProxyTool] %s.%s failed: %s",
                            plugin,
                            method,
                            e,
                            exc_info=True,
                        )
                        return f"Error executing tool: {str(e)}"

                return _proxy

            fn = _make_proxy(name, method_name, client_runner)
            try:
                tool = Function(
                    name=tool_name,
                    description=description,
                    entrypoint=fn,
                    parameters=params_schema
                    if params_schema.get("properties")
                    else None,
                )
                tools.append(tool)
                logger.debug("Added client proxy tool: %s", tool_name)
            except Exception as e:
                logger.warning("Failed to create proxy tool %s: %s", tool_name, e)
    return tools
