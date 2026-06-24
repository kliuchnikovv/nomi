"""Two-step confirmation state for slash commands (``/reset``, ``/forget``).

The pending entry lives in Redis for 120 s. Any other input clears it — the
dispatcher is responsible for calling :func:`clear` at the start of every
command, so a non-matching second message naturally cancels the pending op.
"""

from __future__ import annotations

import json
from typing import Any

_TTL_SECONDS = 120


def _key(user_id: str, chat_id: str) -> str:
    return f"cmd:pending:{user_id}:{chat_id}"


async def set_pending(
    redis_client: Any,
    user_id: str,
    chat_id: str,
    cmd: str,
    data: dict[str, Any] | None = None,
) -> None:
    if not redis_client:
        return
    payload = {"cmd": cmd, "data": data or {}}
    await redis_client.set(
        _key(user_id, chat_id), json.dumps(payload), ex=_TTL_SECONDS
    )


async def get_pending(
    redis_client: Any, user_id: str, chat_id: str
) -> dict[str, Any] | None:
    if not redis_client:
        return None
    raw = await redis_client.get(_key(user_id, chat_id))
    if not raw:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


async def clear(redis_client: Any, user_id: str, chat_id: str) -> None:
    if not redis_client:
        return
    await redis_client.delete(_key(user_id, chat_id))
