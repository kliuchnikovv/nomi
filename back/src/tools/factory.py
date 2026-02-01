from datetime import datetime, timezone
import logging
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List

from agno.tools import Toolkit
from agno.tools.gmail import GmailTools
from agno.tools.googlecalendar import GoogleCalendarTools
from agno.tools.github import GithubTools
from src.tools.duckduckgo_custom import (
    DuckDuckGoTools as WebSearchTools,
)  # Use our custom version
from google.oauth2.credentials import Credentials
from src.integrations.registry import (
    get_provider,
    should_include_in_tools,
)

DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token"

logger = logging.getLogger(__name__)

ToolBuilder = Callable[[Dict[str, Any]], Toolkit]


@dataclass
class ToolItem:
    name: str
    params: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolsConfig:
    entries: Dict[str, Dict[str, Any]] = field(default_factory=dict)

    def add(self, name: str, **params: Any) -> None:
        """Register or update a tool configuration."""
        existing = self.entries.get(name, {})
        existing.update({k: v for k, v in params.items() if v is not None})
        self.entries[name] = existing

    def __iter__(self) -> Iterator[ToolItem]:
        for name, params in self.entries.items():
            yield ToolItem(name=name, params=params)


def _instantiate_tool(
    cls: type[Toolkit],
    kwargs_list: List[Dict[str, Any]] | Dict[str, Any],
    tool_name: str,
) -> Toolkit:
    """
    Пытается создать тул с вариациями kwargs; если все варианты отклонены,
    возвращает инстанс по умолчанию.
    """
    attempts = kwargs_list if isinstance(kwargs_list, list) else [kwargs_list]
    for attempt in attempts:
        try:
            return cls(**attempt)
        except TypeError as exc:
            logger.debug("%s params rejected (%s): %s", tool_name, attempt, exc)
    logger.warning("%s params rejected, using defaults", tool_name)
    return cls()


def _make_credentials(params: Dict[str, Any]) -> Credentials | None:
    # Support nested creds dict
    creds_data = (
        params.get("creds", {}) if isinstance(params.get("creds"), dict) else params
    )

    token = creds_data.get("access_token") or creds_data.get("token")
    refresh = creds_data.get("refresh_token")
    token_uri = creds_data.get("token_uri") or DEFAULT_TOKEN_URI
    client_id = creds_data.get("client_id")
    client_secret = creds_data.get("client_secret")

    if not any([token, refresh, client_id, client_secret]):
        return None

    try:
        return Credentials(
            token=token,
            refresh_token=refresh,
            token_uri=token_uri,
            client_id=client_id,
            client_secret=client_secret,
        )
    except Exception as exc:
        logger.warning("Failed to build credentials, will continue without: %s", exc)
        return None

def _build_web_search(_: Dict[str, Any]) -> Toolkit:
    """Build web search tool (DuckDuckGo)."""
    logger.info("[WebSearch] Building web search tools")
    tool = WebSearchTools()
    tool.add_instructions = True
    tool.instructions = """You have access to web search.
Use this to search for current information, news, and facts from the internet.
Always cite sources when providing information from search results."""
    return tool

TOOL_BUILDERS: Dict[str, ToolBuilder] = {
    "web_search": _build_web_search,
}


def register_tool(name: str, builder: ToolBuilder) -> None:
    """Extend factory with custom builders."""
    TOOL_BUILDERS[name] = builder


async def build(config: ToolsConfig) -> List[Toolkit]:
    tools: List[Toolkit] = []
    logger.debug(
        "[Tools] Building tools from config with %d entries", len(config.entries)
    )
    logger.debug("[Tools] Registered builders: %s", list(TOOL_BUILDERS.keys()))

    for item in config:
        logger.debug("[Tools] Processing tool item: %s", item.name)

        # Проверяем через реестр, является ли это серверной интеграцией
        # Клиентские интеграции не должны обрабатываться здесь
        provider = get_provider(item.name.lower())
        if provider and not should_include_in_tools(item.name.lower()):
            logger.debug(
                f"[Tools] Skipping client-side integration: {item.name} (executes on device)"
            )
            continue

        # Try exact match first
        builder = TOOL_BUILDERS.get(item.name)

        # If no exact match, try prefix match (e.g., "Gmail (email)" matches "Gmail")
        if not builder:
            item_name_lower = item.name.lower()
            for registered_name, registered_builder in TOOL_BUILDERS.items():
                if item_name_lower.startswith(registered_name.lower()):
                    builder = registered_builder
                    logger.debug(
                        f"[Tools] Matched '{item.name}' to builder '{registered_name}' (case-insensitive)"
                    )
                    break

        if not builder:
            logger.warning(f"[Tools] No builder found for tool: {item.name}")
            continue

        # Gracefully skip tools that fail to initialize (e.g., missing credentials)
        try:
            tool = builder(item.params)
            tools.append(tool)
            logger.debug(f"[Tools] Successfully built tool: {item.name}")
        except Exception as exc:
            logger.warning(
                "[Tools] Failed to build tool '%s': %s - skipping", item.name, exc
            )
            continue

    return tools
