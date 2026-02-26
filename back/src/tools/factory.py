import logging
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, Callable

from agno.tools import Toolkit
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

ToolBuilder = Callable[[dict[str, Any]], Toolkit]


@dataclass
class ToolItem:
    name: str
    provider: str | None = None
    params: dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolsConfig:
    entries: dict[str, ToolItem] = field(default_factory=dict)

    def add(self, name: str, provider: str | None = None, **params: Any) -> None:
        """Register or update a tool configuration."""
        existing = self.entries.get(name)
        if existing:
            existing.params.update({k: v for k, v in params.items() if v is not None})
            if provider:
                existing.provider = provider
        else:
            self.entries[name] = ToolItem(
                name=name,
                provider=provider,
                params={k: v for k, v in params.items() if v is not None},
            )

    def __iter__(self) -> Iterator[ToolItem]:
        for item in self.entries.values():
            yield item


def _instantiate_tool(
    cls: type[Toolkit],
    kwargs_list: list[dict[str, Any]] | dict[str, Any],
    tool_name: str,
) -> Toolkit:
    """
    Attempts to create a tool with variations of kwargs; if all variants are rejected,
    returns default instance.
    """
    attempts = kwargs_list if isinstance(kwargs_list, list) else [kwargs_list]
    for attempt in attempts:
        try:
            return cls(**attempt)
        except TypeError as exc:
            logger.debug("%s params rejected (%s): %s", tool_name, attempt, exc)
    logger.warning("%s params rejected, using defaults", tool_name)
    return cls()


def _make_credentials(params: dict[str, Any]) -> Credentials | None:
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


def _build_web_search(_: dict[str, Any]) -> Toolkit:
    """Build web search tool (DuckDuckGo)."""
    logger.info("[WebSearch] Building web search tools")
    tool = WebSearchTools()
    tool.add_instructions = True
    tool.instructions = """You have access to web search.
Use this to search for current information, news, and facts from the internet.
Always cite sources when providing information from search results."""
    return tool


TOOL_BUILDERS: dict[str, ToolBuilder] = {
    "web_search": _build_web_search,
}


def register_tool(name: str, builder: ToolBuilder) -> None:
    """Extend factory with custom builders."""
    TOOL_BUILDERS[name] = builder


async def build(config: ToolsConfig) -> list[Toolkit]:
    tools: list[Toolkit] = []
    logger.debug(
        "[Tools] Building tools from config with %d entries", len(config.entries)
    )
    logger.debug("[Tools] Registered builders: %s", list(TOOL_BUILDERS.keys()))

    for item in config:
        logger.debug("[Tools] Processing tool item: %s", item.name)

        # Check via registry if this is server-side integration
        # Client-side integrations should not be processed here
        provider = get_provider(item.name.lower())
        if provider and not should_include_in_tools(item.name.lower()):
            logger.debug(
                f"[Tools] Skipping client-side integration: {item.name} (executes on device)"
            )
            continue

        # Try matching via provider name if available (most reliable)
        builder = None
        if item.provider:
            builder = TOOL_BUILDERS.get(item.provider.lower())
            if builder:
                logger.debug(
                    f"[Tools] Matched '{item.name}' to builder via provider '{item.provider}'"
                )

        # Try matching via manifest search (checks internal name and display name)
        if not builder:
            try:
                from src.plugins.loader import get_manifest

                manifest = get_manifest(item.name)
                if manifest:
                    manifest_name = manifest.get("name")
                    if isinstance(manifest_name, str):
                        builder = TOOL_BUILDERS.get(manifest_name)
                        if builder:
                            logger.debug(
                                f"[Tools] Matched '{item.name}' to builder via manifest search: {manifest_name}"
                            )
            except Exception:
                pass

        # If no match, try prefix match (e.g., "Gmail (email)" matches "Gmail")
        if not builder:
            item_name_lower = item.name.lower()
            for registered_name, registered_builder in TOOL_BUILDERS.items():
                if item_name_lower.startswith(registered_name.lower()):
                    builder = registered_builder
                    logger.debug(
                        f"[Tools] Matched '{item.name}' to builder '{registered_name}' (prefix match)"
                    )
                    break

        if not builder:
            logger.warning(f"[Tools] No builder found for tool: {item.name}")
            continue

        # Gracefully skip tools that fail to initialize (e.g., missing credentials)
        try:
            # Multi-account: build one Toolkit per account with a unique name so
            # the model can distinguish between them (e.g. "github_work", "github_personal").
            # credentials maps account_id -> per-account params dict.
            credentials = item.params.get("credentials")
            accounts = item.params.get("accounts")
            if credentials and isinstance(credentials, dict) and accounts and len(accounts) > 0:
                for account in accounts:
                    account_id = account.get("id")
                    if not account_id:
                        continue
                    account_creds = credentials.get(account_id)
                    if not account_creds or not isinstance(account_creds, dict):
                        continue
                    try:
                        account_creds["account_id"] = account_id  # Inject account_id into params
                        account_creds["display_name"] = account.get("display_name") or account_id[:8]  # Also inject display_name
                        tool = builder(account_creds)
                        # Give the toolkit a unique name so LLM can select the right account.
                        display = account.get("display_name") or account_id[:8]
                        # Sanitize: replace characters invalid in tool names
                        safe_display = display.replace("@", "_at_").replace(".", "_").replace("-", "_")
                        tool.name = f"{item.name}_{safe_display}"
                        tools.append(tool)
                        logger.debug(
                            "[Tools] Built tool '%s' for account %s",
                            tool.name,
                            account_id,
                        )
                    except Exception as exc:
                        logger.warning(
                            "[Tools] Failed to build tool '%s' for account %s: %s - skipping",
                            item.name,
                            account_id,
                            exc,
                        )
            else:
                tool = builder(item.params)
                tools.append(tool)
                logger.debug(f"[Tools] Successfully built tool: {item.name}")
        except Exception as exc:
            logger.warning(
                "[Tools] Failed to build tool '%s': %s - skipping", item.name, exc
            )
            continue

    return tools
