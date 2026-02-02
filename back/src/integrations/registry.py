"""
Integration registry for Python backend.

Uses plugin manifests when available; falls back to legacy REGISTRY for providers
without a manifest.
"""

from enum import Enum
from typing import Any

from typing import TYPE_CHECKING, Callable, Optional

if TYPE_CHECKING:
    from agno.tools import Toolkit
    ToolBuilder = Callable[[dict[str, Any]], "Toolkit"]
else:
    ToolBuilder = Callable[[dict[str, Any]], Any]


class StorageType(str, Enum):
    """Storage type for integration data."""

    CLIENT_ONLY = "client"
    SERVER = "server"
    HYBRID = "hybrid"


class ToolType(str, Enum):
    """Tool execution type."""

    SERVER_SIDE = "server"
    CLIENT_SIDE = "client"


class ProviderDefinition:
    """Integration provider definition."""

    def __init__(
        self,
        name: str,
        display_name: str,
        storage_type: StorageType,
        tool_type: ToolType,
        builder: Optional[ToolBuilder] = None,
        description: str = "",
    ):
        self.name = name
        self.display_name = display_name
        self.storage_type = storage_type
        self.tool_type = tool_type
        self.builder = builder
        self.description = description


def _manifest_to_provider(name: str, m: dict[str, Any]) -> ProviderDefinition:
    """Build ProviderDefinition from plugin manifest."""
    exec_type = (m.get("execution") or {}).get("type", "client")
    if exec_type == "server":
        storage_type = StorageType.SERVER
        tool_type = ToolType.SERVER_SIDE
    elif exec_type == "hybrid":
        storage_type = StorageType.HYBRID
        tool_type = ToolType.SERVER_SIDE
    else:
        storage_type = StorageType.CLIENT_ONLY
        tool_type = ToolType.CLIENT_SIDE
    return ProviderDefinition(
        name=name,
        display_name=m.get("display_name", name),
        storage_type=storage_type,
        tool_type=tool_type,
        description=m.get("description", ""),
    )


# Legacy registry for providers without a plugin manifest
REGISTRY: dict[str, ProviderDefinition] = {}


def get_provider(name: str) -> Optional[ProviderDefinition]:
    """Get provider definition by name (from plugin manifest or legacy REGISTRY)."""
    name_lower = name.lower()
    try:
        from src.plugins.loader import get_manifest
        m = get_manifest(name_lower)
        if m:
            return _manifest_to_provider(name_lower, m)
    except Exception:
        pass
    return REGISTRY.get(name_lower)


def get_server_side_providers() -> dict[str, ProviderDefinition]:
    """Get all server-side providers."""
    out: dict[str, ProviderDefinition] = {}
    try:
        from src.plugins.loader import get_manifests, load_plugins
        load_plugins()
        for m in get_manifests():
            exec_type = (m.get("execution") or {}).get("type", "")
            if exec_type in ("server", "hybrid"):
                name = m.get("name", "")
                if name:
                    out[name] = _manifest_to_provider(name, m)
    except Exception:
        pass
    for name, p in REGISTRY.items():
        if p.tool_type == ToolType.SERVER_SIDE:
            out[name] = p
    return out


def get_client_side_providers() -> dict[str, ProviderDefinition]:
    """Get all client-side providers."""
    out: dict[str, ProviderDefinition] = {}
    try:
        from src.plugins.loader import get_manifests, load_plugins
        load_plugins()
        for m in get_manifests():
            exec_type = (m.get("execution") or {}).get("type", "")
            if exec_type == "client":
                name = m.get("name", "")
                if name:
                    out[name] = _manifest_to_provider(name, m)
    except Exception:
        pass
    for name, p in REGISTRY.items():
        if p.tool_type == ToolType.CLIENT_SIDE:
            out[name] = p
    return out


def is_server_side(provider_name: str) -> bool:
    """Check if provider is server-side."""
    try:
        from src.plugins.loader import is_server_side_plugin, load_plugins
        load_plugins()
        if is_server_side_plugin(provider_name):
            return True
    except Exception:
        pass
    p = REGISTRY.get(provider_name.lower())
    return p is not None and p.tool_type == ToolType.SERVER_SIDE


def is_client_side(provider_name: str) -> bool:
    """Check if provider is client-side."""
    p = get_provider(provider_name)
    if not p:
        return False
    return p.tool_type == ToolType.CLIENT_SIDE


def should_include_in_tools(provider_name: str) -> bool:
    """
    True if provider should be included in tools list for Python backend.
    Only server-side providers are included; client-side execute on device.
    """
    return is_server_side(provider_name)
