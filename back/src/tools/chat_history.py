from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agno.knowledge import Knowledge

logger = logging.getLogger(__name__)


def make_search_chat_history(knowledge: "Knowledge", user_id: str):
    """Return a search_chat_history function bound to the given user."""

    def search_chat_history(query: str, limit: int = 5) -> str:
        """Search through older conversation history for relevant context.

        Use this when you need to recall something from earlier in our conversation
        that is no longer visible in the current context window.

        Args:
            query: What to search for in the older conversation history.
            limit: Maximum number of results to return (default 5).

        Returns:
            Formatted excerpts from older messages, or a message indicating no results.
        """
        try:
            results = knowledge.search(
                query,
                filters={"user_id": user_id, "source": "chat_history"},
                limit=limit,
            )
        except Exception as exc:
            logger.warning("[chat_history] search failed: %s", exc)
            return "Could not search conversation history."

        if not results:
            return "No relevant history found."

        lines = []
        for r in results:
            meta = getattr(r, "meta", {}) or {}
            ts = meta.get("timestamp", "")
            role = meta.get("role", "unknown")
            prefix = f"[{ts}] {role}" if ts else role
            lines.append(f"{prefix}: {r.content}")

        return "\n\n".join(lines)

    return search_chat_history
