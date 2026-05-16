# backward-compat shim — import from nomi.py instead
from src.agents.nomi import NomiAgent as SouperAgent, STALE_PREFIX, name  # noqa: F401
