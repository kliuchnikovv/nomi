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
from src.tools.jules import JulesTools
from src.tools.client_side import ClientGmailTools, ClientRagTools
from src.tools.ui import ClientUITools
from src.rag_service import KnowledgeSearchTool


class SafeGithubTools(GithubTools):
    """
    Wrapper over GithubTools that makes 'message' optional for file operations.
    This prevents Pydantic validation errors when the agent doesn't provide commit messages.
    """

    def create_file(
        self,
        repo_name: str,
        path: str,
        content: str,
        message: str = "Update via Genie Agent",
    ) -> str:
        """
        Creates a file in a repository.

        Args:
            repo_name: The name of the repository (owner/repo format).
            path: The path to the file within the repository.
            content: The content to write to the file.
            message: The commit message (optional, defaults to generic message).
        """
        return super().create_file(
            repo_name=repo_name, path=path, content=content, message=message
        )

    def update_file(
        self,
        repo_name: str,
        path: str,
        content: str,
        sha: str,
        message: str = "Update via Genie Agent",
    ) -> str:
        """
        Updates a file in a repository.

        Args:
            repo_name: The name of the repository (owner/repo format).
            path: The path to the file within the repository.
            content: The new content for the file.
            sha: The SHA of the file being replaced.
            message: The commit message (optional, defaults to generic message).
        """
        return super().update_file(
            repo_name=repo_name, path=path, content=content, sha=sha, message=message
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


def _build_gmail(params: Dict[str, Any]) -> Toolkit:
    base_allowed = {"port", "name"}
    base = {k: v for k, v in params.items() if k in base_allowed and v is not None}
    variants: List[Dict[str, Any]] = []

    creds = _make_credentials(params)
    if creds:
        variants.append({**base, "creds": creds})
        tool = _instantiate_tool(GmailTools, variants, "gmail")
    else:
        # If no credentials, use Client Side Tools
        logger.info("[Gmail] No credentials provided, using ClientGmailTools")
        tool = ClientGmailTools()

    # Add account context for multi-account support

    # Add account context for multi-account support
    account_email = params.get("account_email", "")
    if account_email:
        tool.add_instructions = True
        tool.instructions = f"""This Gmail tool operates the mailbox: {account_email}
Only use this tool when the user wants to interact with {account_email}."""
        logger.debug("[Gmail] Added account context for %s", account_email)

    return tool


def _build_google_calendar(params: Dict[str, Any]) -> Toolkit:
    base_allowed = {"name"}  # Calendar инструмент не использует порт
    base = {k: v for k, v in params.items() if k in base_allowed and v is not None}
    variants: List[Dict[str, Any]] = []

    creds = _make_credentials(params)

    if creds:
        # GoogleCalendarTools не принимает creds в __init__, но использует их в _auth
        # Поэтому создаем тул и проставляем creds вручную
        tool = _instantiate_tool(GoogleCalendarTools, variants, "google_calendar")
        tool.creds = creds
    else:
        # If no credentials, use Client Side Tools
        from src.tools.client_side import ClientCalendarTools

        logger.info("[GC] No credentials provided, using ClientCalendarTools")
        tool = ClientCalendarTools()

    now = datetime.now(timezone.utc)

    # Add account context for multi-account support
    account_email = params.get("account_email", "")
    account_context = f" for {account_email}" if account_email else ""

    tool.add_instructions = True
    tool.instructions = f"""You are operating the Google Calendar tool{account_context}. 
Treat current time as {now}.
- Before creating/updating events, confirm the user's timezone, date(s), and duration; ask if missing.
- When reading/searching events, use current time as a reference and clarify the desired time range.
- Check for conflicts: compare proposed slots with existing events, report overlaps, and suggest alternatives.
- Capture key fields: title, start, end, timezone, attendees (email), description, location/meeting link, reminders.
- After any operation, briefly confirm what was created/updated/found, when, and in which timezone.
- Do not invent data and do not perform actions without explicit user permission.
- If additional access is required or permissions are missing, say so and request reauthorization.
- If there are multiple calendar accounts available, clarify which one to use before proceeding."""

    logger.debug(f"[GC] instructions are: {tool.instructions}")

    return tool


def _build_rag(_: Dict[str, Any]) -> Toolkit:
    """Build client-side RAG tool for local vector search."""
    logger.info("[RAG] Using ClientRagTools for local knowledge search")
    return ClientRagTools()


def _build_github(params: Dict[str, Any]) -> Toolkit:
    """Build SafeGithubTools with access token from integration."""
    logger.info(
        "[GitHub] Building SafeGithubTools with params keys: %s", list(params.keys())
    )

    # Extract access token from params (passed from Go API integration)
    creds_data = (
        params.get("creds", {}) if isinstance(params.get("creds"), dict) else {}
    )
    logger.debug(
        "[GitHub] creds_data keys: %s",
        list(creds_data.keys()) if creds_data else "empty",
    )

    access_token = creds_data.get("token") or params.get("access_token")
    username = params.get("username", "")
    account_email = params.get("account_email", "")

    if not access_token:
        logger.warning("[GitHub] No access token found in params")
        raise ValueError("GitHub access token is required")

    # Mask token for logging (show first 8 and last 4 chars)
    masked_token = (
        f"{access_token[:8]}...{access_token[-4:]}" if len(access_token) > 12 else "***"
    )
    logger.info(
        "[GitHub] Found access token: %s for user: %s",
        masked_token,
        username or account_email,
    )
    # Use SafeGithubTools to make 'message' optional for create_file/update_file
    tool = SafeGithubTools(access_token=access_token)
    logger.info(
        "[GitHub] Created SafeGithubTools with access token for user: %s",
        username or account_email,
    )

    # Add context instructions
    tool.add_instructions = True
    account_context = f" for GitHub user: {username}" if username else ""
    tool.instructions = f"""You have access to GitHub API tools{account_context}.
You can:
- Search repositories, issues, and pull requests
- Get repository information and file contents
- List and manage issues
- Create and review pull requests
- Access user information

Always confirm repository ownership before making changes."""

    return tool


def _build_web_search(_: Dict[str, Any]) -> Toolkit:
    """Build web search tool (DuckDuckGo)."""
    logger.info("[WebSearch] Building web search tools")
    tool = WebSearchTools()
    tool.add_instructions = True
    tool.instructions = """You have access to web search.
Use this to search for current information, news, and facts from the internet.
Always cite sources when providing information from search results."""
    return tool


def _build_jules(params: Dict[str, Any]) -> Toolkit:
    """Build JulesTools with API key."""
    logger.info("[Jules] Building JulesTools")

    # Check for credentials in nested 'creds' or directly in params
    creds_data = (
        params.get("creds", {}) if isinstance(params.get("creds"), dict) else params
    )

    # Support 'key', 'api_key', or 'token'
    api_key = (
        creds_data.get("api_key") or creds_data.get("key") or creds_data.get("token")
    )

    if not api_key:
        logger.warning("[Jules] No API key found in params")
        raise ValueError("API key required for Jules tool")

    masked_key = f"{api_key[:4]}...{api_key[-4:]}" if len(api_key) > 8 else "***"
    logger.info("[Jules] Using API key: %s", masked_key)

    return JulesTools(api_key=api_key)


def _build_knowledge_search(params: Dict[str, Any]) -> Toolkit:
    """Build KnowledgeSearchTool with user_id context."""
    user_id = params.get("user_id")
    if not user_id:
        # Try to find user_id in creds or other params if structure varies,
        # but typically it should be top-level or injected by caller
        logger.warning("[Knowledge] No user_id provided for KnowledgeSearchTool")
        raise ValueError("user_id is required for KnowledgeSearchTool")

    logger.info("[Knowledge] Building KnowledgeSearchTool for user: %s", user_id)
    return KnowledgeSearchTool(user_id=user_id)


def _build_ui(_: Dict[str, Any]) -> Toolkit:
    """Build client-side UI tools."""
    logger.info("[UI] Using ClientUITools")
    return ClientUITools()


TOOL_BUILDERS: Dict[str, ToolBuilder] = {
    "Gmail": _build_gmail,
    "Google Calendar": _build_google_calendar,
    "Calendar": _build_google_calendar,
    "GitHub": _build_github,
    "rag": _build_rag,
    "web_search": _build_web_search,
    "Jules": _build_jules,
    "knowledge_search": _build_knowledge_search,
    "ui": _build_ui,
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
