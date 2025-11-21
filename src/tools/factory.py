import logging
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List

from agno.tools import Toolkit
from agno.tools.gmail import GmailTools
from agno.tools.googlecalendar import GoogleCalendarTools
from google.oauth2.credentials import Credentials

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


def _instantiate_tool(cls: type[Toolkit], kwargs_list: List[Dict[str, Any]] | Dict[str, Any], tool_name: str) -> Toolkit:
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
    token = params.get("access_token") or params.get("token")
    refresh = params.get("refresh_token")
    token_uri = params.get("token_uri") or DEFAULT_TOKEN_URI
    client_id = params.get("client_id")
    client_secret = params.get("client_secret")

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


def _build_gmail(params: Dict[str, Any]) -> Toolkit:
    base_allowed = {"port", "name"}
    base = {k: v for k, v in params.items() if k in base_allowed and v is not None}
    variants: List[Dict[str, Any]] = []

    creds = _make_credentials(params)
    if creds:
        variants.append({**base, "creds": creds})

    variants.append(base)

    return _instantiate_tool(GmailTools, variants, "gmail")


def _build_google_calendar(params: Dict[str, Any]) -> Toolkit:
    base_allowed = {"name"}  # Calendar инструмент не использует порт
    base = {k: v for k, v in params.items() if k in base_allowed and v is not None}
    variants: List[Dict[str, Any]] = []

    creds = _make_credentials(params)
    if creds:
        variants.append({**base, "creds": creds})

    variants.append(base)

    return _instantiate_tool(GoogleCalendarTools, variants, "google_calendar")


TOOL_BUILDERS: Dict[str, ToolBuilder] = {
    "gmail": lambda params: GmailTools(**params),
    "google_calendar": lambda params: GoogleCalendarTools(**params),
}


def register_tool(name: str, builder: ToolBuilder) -> None:
    """Extend factory with custom builders."""
    TOOL_BUILDERS[name] = builder


async def build(config: ToolsConfig) -> List[Toolkit]:
    tools: List[Toolkit] = []
    for item in config:
        builder = TOOL_BUILDERS.get(item.name)
        if not builder:
            continue
        tools.append(builder(item.params))
    return tools
