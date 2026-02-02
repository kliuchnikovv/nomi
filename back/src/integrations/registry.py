"""
Integration registry for Python backend.

Defines provider mappings to builders and metadata about tool types.
"""

from enum import Enum
from agno.tools import Toolkit

from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from src.tools.factory import ToolBuilder
else:
    ToolBuilder = Callable[[dict[str, Any]], Toolkit]


class StorageType(str, Enum):
    """Storage type for integration data."""

    CLIENT_ONLY = "client"  # Data stored only on client (SQLite)
    SERVER = "server"  # Data stored on server (PostgreSQL)
    HYBRID = "hybrid"  # Hybrid storage


class ToolType(str, Enum):
    """Tool execution type."""

    SERVER_SIDE = "server"  # Executes on server (Python)
    CLIENT_SIDE = "client"  # Executes on client (React Native)


class ProviderDefinition:
    """Integration provider definition."""

    def __init__(
        self,
        name: str,
        display_name: str,
        storage_type: StorageType,
        tool_type: ToolType,
        builder: ToolBuilder | None = None,
        description: str = "",
    ):
        self.name = name
        self.display_name = display_name
        self.storage_type = storage_type
        self.tool_type = tool_type
        self.builder = builder
        self.description = description


# Provider registry
REGISTRY: dict[str, ProviderDefinition] = {
    "gmail": ProviderDefinition(
        name="gmail",
        display_name="Gmail",
        storage_type=StorageType.CLIENT_ONLY,
        tool_type=ToolType.CLIENT_SIDE,
        description="Gmail integration - executes on client",
    ),
    "calendar": ProviderDefinition(
        name="calendar",
        display_name="Google Calendar",
        storage_type=StorageType.CLIENT_ONLY,
        tool_type=ToolType.CLIENT_SIDE,
        description="Google Calendar integration - executes on client",
    ),
    "github": ProviderDefinition(
        name="github",
        display_name="GitHub",
        storage_type=StorageType.SERVER,
        tool_type=ToolType.SERVER_SIDE,
        description="GitHub integration - executes on server",
    ),
    "jules": ProviderDefinition(
        name="jules",
        display_name="Jules",
        storage_type=StorageType.SERVER,
        tool_type=ToolType.SERVER_SIDE,
        description="Jules API integration - executes on server",
    ),
}


def get_provider(name: str) -> ProviderDefinition | None:
    """Get provider definition by name."""
    return REGISTRY.get(name.lower())


def get_server_side_providers() -> dict[str, ProviderDefinition]:
    """Get all server-side providers."""
    return {
        name: provider
        for name, provider in REGISTRY.items()
        if provider.tool_type == ToolType.SERVER_SIDE
    }


def get_client_side_providers() -> dict[str, ProviderDefinition]:
    """Get all client-side providers."""
    return {
        name: provider
        for name, provider in REGISTRY.items()
        if provider.tool_type == ToolType.CLIENT_SIDE
    }


def is_server_side(provider_name: str) -> bool:
    """Check if provider is server-side."""
    provider = get_provider(provider_name)
    if not provider:
        return False
    return provider.tool_type == ToolType.SERVER_SIDE


def is_client_side(provider_name: str) -> bool:
    """Check if provider is client-side."""
    provider = get_provider(provider_name)
    if not provider:
        return False
    return provider.tool_type == ToolType.CLIENT_SIDE


def should_include_in_tools(provider_name: str) -> bool:
    """
    Check if provider should be included in tools list for Python backend.

    Only server-side providers should be included in tools list,
    as client-side integrations execute locally on the device.
    """
    return is_server_side(provider_name)
