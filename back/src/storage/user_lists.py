"""Per-user named lists (groceries, todos…), backed by the ``user_lists`` table.

The schema is owned by GORM ``AutoMigrate`` (see api/internal/storage/models.go
``UserList``). This module is the single source of truth for list queries: both
the ``/list`` slash command and the agent's ``ListsTools`` delegate here. Helpers
open a short-lived asyncpg connection per call — list ops are infrequent, which
matches the pattern in ``chat_flags.py`` and ``tools/projects.py``.

Items are stored as a JSONB array of strings, kept in insertion order.
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


async def _connect() -> asyncpg.Connection | None:
    dsn = _get_dsn()
    if not dsn:
        return None
    return await asyncpg.connect(_normalize_dsn(dsn))


def _parse_items(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return []
    else:
        parsed = raw
    if isinstance(parsed, list):
        return [str(x) for x in parsed]
    return []


async def get_lists(user_id: str) -> list[dict[str, Any]]:
    """Return all of the user's lists as ``[{"name", "items", "count"}]``."""
    conn = await _connect()
    if conn is None:
        return []
    try:
        rows = await conn.fetch(
            "SELECT name, items FROM user_lists WHERE user_id = $1::uuid ORDER BY name",
            user_id,
        )
    finally:
        await conn.close()
    result = []
    for row in rows:
        items = _parse_items(row["items"])
        result.append({"name": row["name"], "items": items, "count": len(items)})
    return result


async def get_list(user_id: str, name: str) -> dict[str, Any] | None:
    """Return a single list ``{"name", "items", "count"}`` or ``None``."""
    conn = await _connect()
    if conn is None:
        return None
    try:
        row = await conn.fetchrow(
            "SELECT name, items FROM user_lists WHERE user_id = $1::uuid AND name = $2",
            user_id,
            name,
        )
    finally:
        await conn.close()
    if not row:
        return None
    items = _parse_items(row["items"])
    return {"name": row["name"], "items": items, "count": len(items)}


async def add_item(user_id: str, name: str, item: str) -> dict[str, Any]:
    """Append ``item`` to ``name`` (creating the list if needed). Returns the list."""
    conn = await _connect()
    if conn is None:
        return {"name": name, "items": [], "count": 0}
    try:
        row = await conn.fetchrow(
            """
            INSERT INTO user_lists (user_id, name, items, created_at, updated_at)
            VALUES ($1::uuid, $2, $3::jsonb, NOW(), NOW())
            ON CONFLICT (user_id, name) DO UPDATE
                SET items = user_lists.items || $3::jsonb,
                    updated_at = NOW()
            RETURNING name, items
            """,
            user_id,
            name,
            json.dumps([item]),
        )
    finally:
        await conn.close()
    items = _parse_items(row["items"])
    return {"name": row["name"], "items": items, "count": len(items)}


async def remove_item(
    user_id: str, name: str, ref: str
) -> tuple[str | None, dict[str, Any] | None]:
    """Remove an item from ``name`` by 1-based index or first text match.

    Returns ``(removed_item, updated_list)``. ``removed_item`` is ``None`` when
    the list is missing or no element matched.
    """
    current = await get_list(user_id, name)
    if current is None:
        return None, None
    items = current["items"]

    idx: int | None = None
    ref_stripped = ref.strip()
    if ref_stripped.lstrip("-").isdigit():
        n = int(ref_stripped)
        if 1 <= n <= len(items):
            idx = n - 1
    if idx is None:
        lowered = ref_stripped.lower()
        for i, it in enumerate(items):
            if it.lower() == lowered:
                idx = i
                break
    if idx is None:
        return None, current

    removed = items.pop(idx)
    conn = await _connect()
    if conn is None:
        return removed, {"name": name, "items": items, "count": len(items)}
    try:
        await conn.execute(
            """
            UPDATE user_lists
               SET items = $3::jsonb, updated_at = NOW()
             WHERE user_id = $1::uuid AND name = $2
            """,
            user_id,
            name,
            json.dumps(items),
        )
    finally:
        await conn.close()
    return removed, {"name": name, "items": items, "count": len(items)}


async def delete_list(user_id: str, name: str) -> bool:
    """Delete a list entirely. Returns True if a row was removed."""
    conn = await _connect()
    if conn is None:
        return False
    try:
        status = await conn.execute(
            "DELETE FROM user_lists WHERE user_id = $1::uuid AND name = $2",
            user_id,
            name,
        )
    finally:
        await conn.close()
    # asyncpg returns e.g. "DELETE 1"
    return status.rsplit(" ", 1)[-1] != "0"


async def clear_list(user_id: str, name: str) -> bool:
    """Empty a list's items (keeps the list). Returns True if the list existed."""
    conn = await _connect()
    if conn is None:
        return False
    try:
        status = await conn.execute(
            """
            UPDATE user_lists
               SET items = '[]'::jsonb, updated_at = NOW()
             WHERE user_id = $1::uuid AND name = $2
            """,
            user_id,
            name,
        )
    finally:
        await conn.close()
    return status.rsplit(" ", 1)[-1] != "0"
