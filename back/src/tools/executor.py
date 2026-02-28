from __future__ import annotations

import logging
import sys
from typing import Any, Callable

from agno.tools import Toolkit

logger = logging.getLogger(__name__)


def _build_web_search(_: dict[str, Any]) -> Toolkit:
    from src.tools.duckduckgo_custom import DuckDuckGoTools
    return DuckDuckGoTools()


def _build_gmail(credentials: dict[str, Any]) -> Toolkit:
    from src.tools.factory import _make_credentials
    creds = _make_credentials(credentials)
    try:
        from agno.tools.gmail import GmailTools
        return GmailTools(creds=creds)
    except ImportError:
        from plugins.gmail.server.tools import GmailTools  # type: ignore[import]
        return GmailTools(creds=creds)


def _build_github(credentials: dict[str, Any]) -> Toolkit:
    from src.tools.factory import SafeGithubTools
    token = credentials.get("access_token") or credentials.get("token")
    return SafeGithubTools(access_token=token)


# Maps tool name -> builder function name in this module.
# Stored as names so monkeypatching the module-level functions takes effect.
_BUILDER_NAMES: dict[str, str] = {
    "web_search": "_build_web_search",
    "gmail": "_build_gmail",
    "github": "_build_github",
}

# Public registry for custom builders (direct callable references).
_CUSTOM_BUILDERS: dict[str, Callable[[dict[str, Any]], Toolkit]] = {}


def register_executor(name: str, builder: Callable[[dict[str, Any]], Toolkit]) -> None:
    """Register a custom executor builder."""
    _CUSTOM_BUILDERS[name] = builder


def _get_builder(tool_name: str) -> Callable[[dict[str, Any]], Toolkit] | None:
    """Return the current builder for tool_name, respecting monkeypatching."""
    if tool_name in _CUSTOM_BUILDERS:
        return _CUSTOM_BUILDERS[tool_name]
    func_name = _BUILDER_NAMES.get(tool_name)
    if func_name is None:
        return None
    module = sys.modules[__name__]
    return getattr(module, func_name, None)


class ServerToolExecutor:
    def run(
        self,
        tool_name: str,
        method_name: str,
        params: dict[str, Any],
        credentials: dict[str, Any],
    ) -> str:
        builder = _get_builder(tool_name)
        if not builder:
            raise ValueError(f"No executor registered for: {tool_name}")

        toolkit = builder(credentials)

        method = getattr(toolkit, method_name, None)
        if not callable(method):
            raise ValueError(f"Tool {tool_name} has no method: {method_name}")

        result = method(**params)
        return str(result) if result is not None else ""
