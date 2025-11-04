from __future__ import annotations

from typing import Any, List, Dict, Optional
from sqlalchemy import Table, MetaData, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession


class HistoryLoader:
    def __init__(
        self,
        engine: AsyncEngine,
        messages_table_name: str = "messages",
        order_column: Optional[str] = None,
    ) -> None:
        self.engine = engine
        self.metadata = MetaData()
        self._messages_table_name = messages_table_name
        self.messages: Table | None = None
        # Optional column to order by (e.g., created_at). If None, no explicit ordering.
        self.order_column = order_column

    async def load(self, chat_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        # Lazily reflect the target table using the async engine
        if self.messages is None:
            async with self.engine.begin() as conn:
                await conn.run_sync(self.metadata.reflect, only=[self._messages_table_name])
            self.messages = self.metadata.tables[self._messages_table_name]

        async with AsyncSession(self.engine) as session:
            assert self.messages is not None
            stmt = select(
                self.messages.c.role,  # type: ignore[attr-defined]
                self.messages.c.text,  # type: ignore[attr-defined]
            ).where(
                self.messages.c.chat_id == text("cast(:cid as uuid)")  # type: ignore[attr-defined]
            )
            if self.order_column and hasattr(self.messages.c, self.order_column):
                stmt = stmt.order_by(getattr(self.messages.c, self.order_column))  # type: ignore[attr-defined]
            stmt = stmt.limit(limit)
            rows = (await session.execute(stmt, {"cid": chat_id})).all()
            return [{"role": r[0], "content": r[1]} for r in rows]


def render_history_as_prefix(history: List[Dict[str, Any]]) -> str:
    # Simple textual rendering understood by most LLM prompts
    lines = []
    for m in history:
        role = (m.get("role") or "user").lower()
        content = str(m.get("content") or "")
        lines.append(f"{role}: {content}")
    if not lines:
        return ""
    return "\n".join(lines) + "\n\n"
