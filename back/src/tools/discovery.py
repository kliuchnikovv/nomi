from __future__ import annotations

import asyncio
import json
import logging
import re
import weakref
from typing import Any, Callable, Awaitable

from agno.agent import Agent
from agno.models.base import Model
from agno.tools import Function, Toolkit

from src.tools.catalog import ToolCatalog
from src.tools.factory import ToolsConfig

logger = logging.getLogger(__name__)

_DISCOVERY_PROMPT_TEMPLATE = """You are a tool selection assistant. Given the list of available tools and the user's request,
select the tool names that are most relevant to fulfilling the request.

Return ONLY a JSON array of tool names from the list below. Return at most 5.
Return [] if no tools are relevant.

Available tools:
{catalog_text}

User request: {query}

Respond with a JSON array only, example: ["gmail", "ios_calendar"]
"""


class DiscoverySubAgent:
    """
    Lightweight Agno Agent used ONLY to classify which tools match a query.
    Uses no tools, no memory, no LearningMachine — just a single LLM call.
    """

    def __init__(self, model: Model, catalog: ToolCatalog) -> None:
        self._catalog = catalog
        self._agent = Agent(
            model=model,
            markdown=False,
            telemetry=False,
            stream=False,
        )

    async def find_tools(self, query: str) -> list[str]:
        """
        Return catalog entry names relevant to the given query.
        Re-raises asyncio.CancelledError; returns [] on any other error.
        """
        prompt = _DISCOVERY_PROMPT_TEMPLATE.format(
            catalog_text=self._catalog.to_prompt_text(),
            query=query,
        )
        try:
            result = await self._agent.arun(prompt, stream=False)
            content = (result.content or "") if result else ""
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("[Discovery] Sub-agent call failed: %s", e)
            return []

        # Extract JSON array from response
        match = re.search(r"\[.*?\]", content, re.DOTALL)
        if not match:
            return []
        try:
            names = json.loads(match.group())
        except json.JSONDecodeError:
            return []

        # Validate: only return names actually in the catalog
        return [n for n in names if isinstance(n, str) and n in self._catalog.entries]


async def _build_toolkit_for(
    name: str,
    catalog: ToolCatalog,
    config: ToolsConfig,
    client_tool_runner: Callable[[str, str, dict], Awaitable[str]] | None,
) -> list[Toolkit | Function]:
    """
    Build and return Toolkit/Function objects for a single named tool from the catalog.
    Returns empty list if tool not found or cannot be built.
    """
    entry = catalog.entries.get(name)
    if not entry:
        return []

    if entry.execution_type in ("server", "hybrid"):
        from src.tools.factory import build as build_tools

        try:
            single_config = ToolsConfig()
            single_config.add(name, provider=entry.provider, **entry.params)
            toolkits = await build_tools(single_config)
            return list(toolkits)
        except Exception as e:
            logger.warning("[Discovery] Failed to build server tool '%s': %s", name, e)
            return []

    elif entry.execution_type == "client":
        if client_tool_runner is None:
            logger.debug(
                "[Discovery] No client_tool_runner, skipping client tool '%s'", name
            )
            return []
        from src.plugins.loader import get_manifest
        from src.plugins.tool_gen import build_client_proxy_tools

        manifest = get_manifest(name)
        if not manifest:
            logger.warning("[Discovery] No manifest for client tool '%s'", name)
            return []
        integration_id = entry.params.get("integration_id")
        ids = {name: integration_id} if integration_id else {}
        try:
            result = build_client_proxy_tools([manifest], client_tool_runner, ids)
            if not result:
                logger.warning(
                    "[Discovery] build_client_proxy_tools returned no tools for '%s' "
                    "(manifest execution.type may not be 'client')",
                    name,
                )
            return result
        except Exception as e:
            logger.warning(
                "[Discovery] Failed to build client proxy for '%s': %s", name, e
            )
            return []

    return []


def _format_activation_summary(tool_names: list[str], catalog: ToolCatalog) -> str:
    """Format a human-readable summary of activated tools."""
    if not tool_names:
        return "No specific tools were found for your request. I'll answer from my knowledge."

    lines = [f"Activated {len(tool_names)} tool(s):"]
    for name in tool_names:
        entry = catalog.entries.get(name)
        if entry:
            method_names = [
                m.get("name", "") for m in (entry.methods or []) if m.get("name")
            ]
            methods_str = ", ".join(method_names[:5])
            lines.append(f"- {name} ({entry.display_name}): {entry.description}")
            if methods_str:
                lines.append(f"  Available: {methods_str}")
    lines.append("\nYou can now use the activated tools to complete the task.")
    return "\n".join(lines)


class DiscoveryToolkit(Toolkit):
    """
    Agno Toolkit exposing a single discover_tools(query) function.
    The agent must call this ONCE before using any other tool.
    On call: runs DiscoverySubAgent, builds Toolkit/Function objects,
    adds them to the parent agent, and sets agent._discovery_done = True.
    """

    def __init__(
        self,
        catalog: ToolCatalog,
        config: ToolsConfig,
        sub_agent_model: Model,
        client_tool_runner: Callable[[str, str, dict], Awaitable[str]] | None = None,
    ) -> None:
        super().__init__(name="discovery")
        self._catalog = catalog
        self._config = config
        self._client_tool_runner = client_tool_runner
        self._sub_agent = DiscoverySubAgent(model=sub_agent_model, catalog=catalog)
        self._parent_agent_ref: weakref.ref | None = None
        # Register the function with Agno
        self.register(self.discover_tools)

    def set_parent_agent(self, agent: Any) -> None:
        """Set weak reference to parent agent (call after agent creation)."""
        self._parent_agent_ref = weakref.ref(agent)

    async def discover_tools(self, query: str) -> str:
        """
        Hybrid discovery: Try local Apple AI first, fallback to backend.
        Call ONCE before any other tool.

        Args:
            query: Brief description of what the user wants to accomplish
        """
        tool_names = await self._try_local_discovery(query)

        if tool_names and len(tool_names) > 0:
            return await self._activate_tools(tool_names, "local")

        logger.info("[DiscoveryToolkit] Local discovery failed/empty, using backend")
        tool_names = await self._backend_discovery(query)
        return await self._activate_tools(tool_names, "backend")

    async def _try_local_discovery(self, query: str) -> list[str] | None:
        """Try local Apple AI discovery via client-side apple_discovery plugin."""
        if not self._client_tool_runner:
            logger.debug(
                "[DiscoveryToolkit] No client_tool_runner, skipping local discovery"
            )
            return None

        try:
            catalog_data = {
                name: {
                    "display_name": entry.display_name,
                    "description": entry.description,
                    "methods": entry.methods,
                }
                for name, entry in self._catalog.entries.items()
            }

            result = await self._client_tool_runner(
                "apple_discovery",
                "discover_tools",
                {"query": query, "catalog": catalog_data},
            )

            match = re.search(r"Selected tools: (.+)", result)
            if match:
                tools_str = match.group(1)
                tools = [t.strip() for t in tools_str.split(",") if t.strip()]
                return [t for t in tools if t in self._catalog.entries]

            return None
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("[DiscoveryToolkit] Local discovery error: %s", e)
            return None

    async def _backend_discovery(self, query: str) -> list[str]:
        """Original backend discovery using server-side LLM."""
        try:
            return await self._sub_agent.find_tools(query)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("[DiscoveryToolkit] Backend discovery failed: %s", e)
            return []

    async def _activate_tools(self, tool_names: list[str], source: str) -> str:
        """Activate discovered tools and return summary."""
        agent = self._parent_agent_ref() if self._parent_agent_ref else None
        if agent is None:
            logger.error("[DiscoveryToolkit] Parent agent reference is gone")
            return "Error: parent agent no longer available"

        for name in tool_names:
            try:
                tools = await _build_toolkit_for(
                    name, self._catalog, self._config, self._client_tool_runner
                )
                for t in tools:
                    agent.add_tool(t)
                    logger.info(
                        "[DiscoveryToolkit] Added tool: %s (source: %s)", name, source
                    )
            except Exception as e:
                logger.warning(
                    "[DiscoveryToolkit] Failed to add tool '%s': %s", name, e
                )

        agent._discovery_done = True
        return _format_activation_summary(tool_names, self._catalog)
