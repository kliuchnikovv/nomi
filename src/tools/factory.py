from datetime import datetime, timezone
import logging
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List

from agno.tools import Toolkit
from agno.tools.gmail import GmailTools
from agno.tools.googlecalendar import GoogleCalendarTools
from google.oauth2.credentials import Credentials
from src.tools.memory_writer import MemoryWriter
from src.tools.rag_tool import RagTool

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
    # Support nested creds dict
    creds_data = params.get("creds", {}) if isinstance(params.get("creds"), dict) else params

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
    
    # GoogleCalendarTools не принимает creds в __init__, но использует их в _auth
    # Поэтому создаем тул и проставляем creds вручную
    tool = _instantiate_tool(GoogleCalendarTools, variants, "google_calendar")
    if creds:
        tool.creds = creds

    now = datetime.now(timezone.utc)

    tool.add_instructions = True
    tool.instructions = """You are operating the Google Calendar tool. 
Treat current time as {now}.
- Before creating/updating events, confirm the user’s timezone, date(s), and duration; ask if missing.
- When reading/searching events, use current time as a reference and clarify the desired time range.
- Check for conflicts: compare proposed slots with existing events, report overlaps, and suggest alternatives.
- Capture key fields: title, start, end, timezone, attendees (email), description, location/meeting link, reminders.
- After any operation, briefly confirm what was created/updated/found, when, and in which timezone.
- Do not invent data and do not perform actions without explicit user permission.
- If additional access is required or permissions are missing, say so and request reauthorization."""

    logger.debug("[GC] instructions are: {tool.instructions}")
    
    return tool


def _build_rag(_: Dict[str, Any]) -> Toolkit:
    # Placeholder builder; params are ignored for now
    return RagTool()


def _build_memory_writer(_: Dict[str, Any]) -> Toolkit:
    # Placeholder builder; params are ignored for now
    return MemoryWriter()


TOOL_BUILDERS: Dict[str, ToolBuilder] = {
    "Gmail": _build_gmail,
    "Google Calendar": _build_google_calendar,
    "rag": _build_rag,
    "memory_writer": _build_memory_writer,
}


def register_tool(name: str, builder: ToolBuilder) -> None:
    """Extend factory with custom builders."""
    TOOL_BUILDERS[name] = builder


async def build(config: ToolsConfig) -> List[Toolkit]:
    tools: List[Toolkit] = []
    for item in config:
        # Try exact match first
        builder = TOOL_BUILDERS.get(item.name)
        
        # If no exact match, try prefix match (e.g., "Gmail (email)" matches "Gmail")
        if not builder:
            for registered_name, registered_builder in TOOL_BUILDERS.items():
                if item.name.startswith(registered_name):
                    builder = registered_builder
                    logger.debug(f"[Tools] Matched '{item.name}' to builder '{registered_name}'")
                    break
        
        if not builder:
            logger.warning(f"[Tools] No builder found for tool: {item.name}")
            continue
            
        tools.append(builder(item.params))
    return tools
