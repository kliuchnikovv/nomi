"""Per-chat sticky flags set by slash commands (think_level, compact_summary…).

Backed by the ``chats.session_flags`` JSONB column (GORM-managed). Helpers open
a short-lived asyncpg connection per call — slash commands are infrequent, so
this is fine and matches the pattern used in ``src/tools/projects.py``.
"""

from __future__ import annotations

import json
import os
from typing import Any

import asyncpg


def _normalize_dsn(dsn: str) -> str:
    if dsn.startswith("postgresql://"):
        return dsn.replace("postgresql://", "postgres://", 1)
    return dsn


def _get_dsn() -> str | None:
    return os.getenv("DB_DSN") or None


async def get_flags(chat_id: str) -> dict[str, Any]:
    dsn = _get_dsn()
    if not dsn:
        return {}
    conn = await asyncpg.connect(_normalize_dsn(dsn))
    try:
        row = await conn.fetchrow(
            "SELECT session_flags FROM chats WHERE id = $1::uuid",
            chat_id,
        )
    finally:
        await conn.close()
    if not row or row["session_flags"] is None:
        return {}
    raw = row["session_flags"]
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}
    if isinstance(raw, dict):
        return raw
    return {}


async def set_flag(chat_id: str, key: str, value: Any) -> dict[str, Any]:
    """Merge ``{key: value}`` into chats.session_flags. Returns the new dict."""
    flags = await get_flags(chat_id)
    flags[key] = value
    await _write_flags(chat_id, flags)
    return flags


async def clear_flags(chat_id: str) -> None:
    await _write_flags(chat_id, {})


async def _write_flags(chat_id: str, flags: dict[str, Any]) -> None:
    dsn = _get_dsn()
    if not dsn:
        return
    conn = await asyncpg.connect(_normalize_dsn(dsn))
    try:
        await conn.execute(
            "UPDATE chats SET session_flags = $2::jsonb WHERE id = $1::uuid",
            chat_id,
            json.dumps(flags),
        )
    finally:
        await conn.close()
