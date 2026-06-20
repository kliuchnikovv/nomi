"""Commands package. Modules are imported lazily by `load_commands()`."""

import importlib
import logging
import pkgutil
from pathlib import Path

logger = logging.getLogger(__name__)

_loaded = False


def load_commands() -> None:
    """Import every sibling module so their @command decorators run.

    Idempotent; safe to call multiple times. Modules whose names start
    with '_' are skipped (so test helpers can live alongside)."""
    global _loaded
    if _loaded:
        return
    pkg_path = Path(__file__).parent
    for mod in pkgutil.iter_modules([str(pkg_path)]):
        if mod.name.startswith("_") or mod.name in {"base", "registry", "context"}:
            continue
        try:
            importlib.import_module(f"src.commands.{mod.name}")
        except Exception:
            logger.exception("Failed to import command module %s", mod.name)
    _loaded = True
