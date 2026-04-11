"""
Plugin loader: scans plugins/*/manifest.yaml, loads server/hybrid tool builders,
and exposes manifest data for registry.
"""

import importlib
import logging
import os
from pathlib import Path
from typing import Any, List, Dict, Optional

import yaml

logger = logging.getLogger(__name__)

_manifests: List[Dict[str, Any]] = []
_manifests_by_name: Dict[str, Dict[str, Any]] = {}
_loaded = False


def _repo_root() -> Path:
    """Return repository root (parent of back/)."""
    # back/src/plugins/loader.py -> back/src/plugins -> back/src -> back -> repo root (4 parents)
    p = Path(__file__).resolve()
    for _ in range(4):
        p = p.parent
    return p


def _plugins_dir() -> Path:
    """Return plugins directory path (plugins at repo root)."""
    env = os.environ.get("PLUGINS_DIR")
    if env:
        return Path(env).resolve()
    return _repo_root() / "plugins"


def _load_manifests(plugins_dir: Path) -> List[Dict[str, Any]]:
    """Read all manifest.yaml files from plugins_dir subdirs."""
    out: List[Dict[str, Any]] = []
    if not plugins_dir.is_dir():
        logger.warning("plugins directory does not exist: %s", plugins_dir)
        return out
    for entry in plugins_dir.iterdir():
        if not entry.is_dir():
            continue
        manifest_path = entry / "manifest.yaml"
        if not manifest_path.is_file():
            continue
        try:
            with open(manifest_path, encoding="utf-8") as f:
                data = yaml.safe_load(f)
            if not isinstance(data, dict):
                continue
            name = data.get("name") or entry.name
            data["name"] = name
            out.append(data)
            logger.debug("loaded plugin manifest: %s", name)
        except Exception as e:
            logger.warning("failed to load manifest %s: %s", manifest_path, e)
    return out


def _register_server_builders(plugins_dir: Path, repo_root: Path) -> None:
    """Import plugins/<name>/server/tools and register build() in TOOL_BUILDERS."""
    import sys

    # Parent of plugins_dir contains the "plugins" package (e.g. api/ or /app)
    plugins_parent = plugins_dir.parent
    if str(plugins_parent) not in sys.path:
        sys.path.insert(0, str(plugins_parent))

    from src.tools.factory import register_tool

    for m in _manifests:
        name = m.get("name", "")
        exec_type = (m.get("execution") or {}).get("type", "")
        if exec_type not in ("server", "hybrid"):
            continue

        # Check include flag in tools configuration
        tools_config = m.get("tools", {})
        include = tools_config.get("include", True)
        if not include:
            logger.info("plugin %s: skipped (include=false in manifest)", name)
            continue

        server_dir = plugins_dir / name / "server"
        if not server_dir.is_dir():
            continue
        tools_module_name = f"plugins.{name}.server.tools"
        try:
            mod = importlib.import_module(tools_module_name)
            build = getattr(mod, "build", None)
            if not callable(build):
                logger.warning("plugin %s: no build() in server/tools", name)
                continue
            register_tool(name, build)
            logger.info("registered server plugin builder: %s", name)
        except Exception as e:
            logger.warning("failed to load plugin %s server tools: %s", name, e)


def _register_delivery_handlers() -> None:
    """Import plugins/<name>/server/delivery and register DeliveryHandler instances."""
    from src.server.delivery import DeliveryRegistry

    for m in _manifests:
        name = m.get("name", "")
        delivery_module_name = f"plugins.{name}.server.delivery"
        try:
            mod = importlib.import_module(delivery_module_name)
            # Look for a class named <Name>DeliveryHandler or just DeliveryHandler
            handler_cls = None
            for attr_name in dir(mod):
                obj = getattr(mod, attr_name)
                if (
                    isinstance(obj, type)
                    and attr_name.endswith("DeliveryHandler")
                    and attr_name != "DeliveryHandler"
                ):
                    handler_cls = obj
                    break
            if handler_cls is None:
                handler_cls = getattr(mod, "DeliveryHandler", None)
            if handler_cls is not None:
                DeliveryRegistry.register(name, handler_cls())
        except ImportError:
            pass  # Plugin has no delivery module, that's fine
        except Exception as e:
            logger.warning("failed to load delivery handler for %s: %s", name, e)


def load_plugins() -> None:
    """Load plugin manifests and register server/hybrid tool builders. Idempotent."""
    global _manifests, _manifests_by_name, _loaded
    if _loaded:
        return
    plugins_dir = _plugins_dir()
    repo_root = _repo_root()
    _manifests = _load_manifests(plugins_dir)
    _manifests_by_name = {m["name"]: m for m in _manifests}
    _register_server_builders(plugins_dir, repo_root)
    _register_delivery_handlers()
    _loaded = True


def get_manifests() -> List[Dict[str, Any]]:
    """Return loaded manifests (call load_plugins() first if needed)."""
    return list(_manifests)


def get_manifest(name: str) -> Optional[Dict[str, Any]]:
    """Return manifest for plugin name or None. Supports prefix and display name matching."""
    name_lower = name.lower()

    # 1. Exact match first
    if name_lower in _manifests_by_name:
        return _manifests_by_name[name_lower]

    # 2. Check display names (exact or prefix)
    for m in _manifests:
        display_name = m.get("display_name", "").lower()
        if display_name and (
            name_lower == display_name or name_lower.startswith(display_name)
        ):
            return m

    # 3. Prefix match on internal name (longest candidate first)
    # This handles cases like "Gmail (user@example.com)" matching "gmail"
    for key in sorted(_manifests_by_name.keys(), key=len, reverse=True):
        if name_lower.startswith(key):
            return _manifests_by_name[key]

    return None


def is_server_side_plugin(name: str) -> bool:
    """True if plugin has execution.type server or hybrid."""
    m = get_manifest(name)
    if not m:
        return False
    exec_type = (m.get("execution") or {}).get("type", "")
    return exec_type in ("server", "hybrid")


def register_plugin_routes(app) -> list:
    """Scan loaded plugins for routes.py and auto-register FastAPI routers.

    Returns a list of async startup coroutine functions collected from plugins
    (any module-level ``startup`` async function). The caller must await each one.
    """
    startup_hooks = []
    for m in _manifests:
        name = m.get("name", "")
        routes_module_name = f"plugins.{name}.server.routes"
        try:
            mod = importlib.import_module(routes_module_name)
            router = getattr(mod, "router", None)
            if router is not None:
                app.include_router(router)
                logger.info("registered plugin routes: %s", name)
            startup_fn = getattr(mod, "startup", None)
            if callable(startup_fn):
                startup_hooks.append(startup_fn)
        except ImportError:
            pass  # Plugin has no routes module
        except Exception as e:
            logger.warning("failed to register plugin routes for %s: %s", name, e)
    return startup_hooks
