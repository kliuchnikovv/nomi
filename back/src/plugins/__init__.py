"""Plugin loader and manifest-based registry."""

from src.plugins.loader import (
    load_plugins,
    get_manifests,
    get_manifest,
    is_server_side_plugin,
)

__all__ = [
    "load_plugins",
    "get_manifests",
    "get_manifest",
    "is_server_side_plugin",
]
