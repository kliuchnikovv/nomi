from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

_WEB_SEARCH_ENTRY_DEFAULTS = dict(
    display_name="Web Search",
    description="Search the internet for current information and news using DuckDuckGo.",
    execution_type="server",
    methods=[{"name": "duckduckgo_search", "description": "Search the web for information"}],
    params={},
    provider="web_search",
)


@dataclass
class ToolEntry:
    name: str
    display_name: str
    description: str
    execution_type: str          # "server", "client", "hybrid"
    methods: list[dict[str, Any]]
    params: dict[str, Any]
    provider: str | None


@dataclass
class ToolCatalog:
    entries: dict[str, ToolEntry] = field(default_factory=dict)

    def to_prompt_text(self) -> str:
        """Render catalog as LLM-readable text for the discovery sub-agent prompt."""
        lines: list[str] = []
        for entry in self.entries.values():
            method_names = [m.get("name", "") for m in (entry.methods or []) if m.get("name")]
            methods_str = ", ".join(method_names) if method_names else "(no methods)"
            lines.append(
                f"- {entry.name} ({entry.execution_type}): {entry.description}\n"
                f"  Methods: {methods_str}"
            )
        return "\n".join(lines)


def build_catalog(config) -> ToolCatalog:
    """
    Build a ToolCatalog from a ToolsConfig.
    Calls load_plugins() (idempotent) to ensure manifests are loaded.
    Always includes the built-in web_search entry.
    """
    from src.plugins.loader import load_plugins, get_manifest

    load_plugins()

    entries: dict[str, ToolEntry] = {}

    for item in config:
        if item.name == "web_search":
            entries["web_search"] = ToolEntry(name="web_search", **_WEB_SEARCH_ENTRY_DEFAULTS)
            continue

        manifest = get_manifest(item.name)
        if not manifest:
            logger.debug("[Catalog] No manifest for tool '%s', skipping", item.name)
            continue

        exec_type = (manifest.get("execution") or {}).get("type", "client")
        entries[item.name] = ToolEntry(
            name=item.name,
            display_name=manifest.get("display_name", item.name),
            description=manifest.get("description", ""),
            execution_type=exec_type,
            methods=manifest.get("methods") or [],
            params=dict(item.params) if item.params else {},
            provider=item.provider,
        )

    # Always ensure web_search is present
    if "web_search" not in entries:
        entries["web_search"] = ToolEntry(name="web_search", **_WEB_SEARCH_ENTRY_DEFAULTS)

    return ToolCatalog(entries=entries)
