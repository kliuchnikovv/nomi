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
    """Return plugins directory path (api/plugins when running from repo)."""
    env = os.environ.get("PLUGINS_DIR")
    if env:
        return Path(env).resolve()
    return _repo_root() / "api" / "plugins"


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
    _loaded = True


def get_manifests() -> List[Dict[str, Any]]:
    """Return loaded manifests (call load_plugins() first if needed)."""
    return list(_manifests)


def get_manifest(name: str) -> Optional[Dict[str, Any]]:
    """Return manifest for plugin name or None."""
    return _manifests_by_name.get(name.lower())


def is_server_side_plugin(name: str) -> bool:
    """True if plugin has execution.type server or hybrid."""
    m = get_manifest(name)
    if not m:
        return False
    exec_type = (m.get("execution") or {}).get("type", "")
    return exec_type in ("server", "hybrid")
