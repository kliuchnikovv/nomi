from __future__ import annotations

import logging
from typing import Any

from src.tools.factory import ToolsConfig

logger = logging.getLogger(__name__)


def _load_manifest(provider_name: str) -> dict | None:
    try:
        from src.plugins.loader import load_plugins, get_manifest
        load_plugins()
    except ImportError:
        return None
    try:
        return get_manifest(provider_name)
    except Exception:
        logger.warning("[Registry] Failed to load manifest for %s", provider_name, exc_info=True)
        return None


class ToolRegistry:
    @staticmethod
    def build(config: ToolsConfig) -> list[dict[str, Any]]:
        """
        Build routing schemas (no credentials) for all tools in config.

        Each schema:
        {
          "name": "gmail",
          "display_name": "Gmail",
          "description": "...",
          "methods": [{"name": "send_email", "description": "...", "parameters": {...}}],
          "accounts": [{"id": "work@gmail.com", "display_name": "work@gmail.com"}],
          "execution": "server" | "client",
        }
        """
        schemas: list[dict[str, Any]] = []
        seen: set[str] = set()

        for entry in config:
            manifest = _load_manifest(entry.name.lower())
            if not manifest:
                if entry.provider:
                    manifest = _load_manifest(entry.provider.lower())
            if not manifest:
                logger.debug("[Registry] No manifest for %s — skipping", entry.name)
                continue

            provider_name = manifest.get("name", entry.name)
            if provider_name in seen:
                continue
            seen.add(provider_name)

            exec_type = (manifest.get("execution") or {}).get("type", "server")
            accounts: list[dict] = entry.params.get("accounts") or []

            schemas.append({
                "name": provider_name,
                "display_name": manifest.get("display_name", provider_name),
                "description": manifest.get("description", ""),
                "methods": manifest.get("methods") or [],
                "accounts": accounts,
                "execution": exec_type,
            })

        return schemas
