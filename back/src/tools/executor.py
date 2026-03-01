from __future__ import annotations

import logging
from typing import Any, Callable

from agno.tools import Toolkit

logger = logging.getLogger(__name__)


def _get_builder(tool_name: str) -> Callable[[dict[str, Any]], Toolkit] | None:
    """Return the current builder for tool_name from factory registry."""
    try:
        from src.tools.factory import TOOL_BUILDERS

        logger.info("[Executor] Registered builders: %s", list(TOOL_BUILDERS.keys()))
        return TOOL_BUILDERS.get(tool_name)
    except ImportError:
        return None


class ServerToolExecutor:
    def run(
        self,
        tool_name: str,
        method_name: str,
        params: dict[str, Any],
        credentials: dict[str, Any],
    ) -> str:
        logger.info("[Executor] tool=%s method=%s", tool_name, method_name)
        logger.info(
            "[Executor] credentials keys: %s",
            list(credentials.keys()) if isinstance(credentials, dict) else "not a dict",
        )
        logger.info(
            "[Executor] credentials (masked): %s",
            {
                k: "***" if "token" in k.lower() or "secret" in k.lower() else v
                for k, v in (
                    credentials.items() if isinstance(credentials, dict) else {}
                )
            },
        )
        logger.info(
            "[Executor] Has access_token: %s",
            bool(credentials.get("access_token") or credentials.get("token")),
        )

        builder = _get_builder(tool_name)
        if not builder:
            raise ValueError(f"No executor registered for: {tool_name}")

        logger.info("[Executor] Found builder for tool=%s", tool_name)
        toolkit = builder(credentials)

        method = getattr(toolkit, method_name, None)
        if not callable(method):
            raise ValueError(f"Tool {tool_name} has no method: {method_name}")

        result = method(**params)
        return str(result) if result is not None else ""
