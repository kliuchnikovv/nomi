from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agno.knowledge import Knowledge

logger = logging.getLogger(__name__)


class UserMemoryTools:
    def __init__(self, knowledge: "Knowledge", user_id: str):
        self.knowledge = knowledge
        self.user_id = user_id

    def add_memory(self, fact: str, category: str = "general") -> str:
        """Add a new fact or preference to the user's memory.

        Use this to remember important information about the user such as:
        - Location / residence (e.g., "lives in Russia", "moved to Spain")
        - Preferences (e.g., "prefers dark mode", "likes coffee")
        - Personal details (e.g., "works as developer", "has a dog")
        - Family/relationships (e.g., "married to Anna", "has two children")

        Args:
            fact: The fact or information to remember about the user.
            category: Category for organizing the memory (default: "general").
                     Options: "general", "location", "preferences", "work", "personal".

        Returns:
            Confirmation message with the stored fact.
        """
        try:
            if hasattr(self.knowledge, "add"):
                self.knowledge.add(
                    content=fact,
                    metadata={
                        "user_id": self.user_id,
                        "source": "user_memory",
                        "category": category,
                    },
                )
                logger.info("[UserMemory] Added memory: %s", fact)
                return f"✓ Remembered: {fact}"
            else:
                logger.warning("[UserMemory] Knowledge does not support add() method")
                return "Memory storage is not available."
        except Exception as exc:
            logger.error("[UserMemory] Failed to add memory: %s", exc)
            return f"Failed to save memory: {exc}"

    def search_memory(self, query: str, limit: int = 5) -> str:
        """Search through stored user memories.

        Use this to recall previously stored facts about the user.

        Args:
            query: What to search for in the user's memories.
            limit: Maximum number of results to return (default: 5).

        Returns:
            Formatted memory results or a message indicating no results.
        """
        try:
            if hasattr(self.knowledge, "search"):
                results = self.knowledge.search(
                    query,
                    filters={"user_id": self.user_id, "source": "user_memory"},
                    limit=limit,
                )
                if not results:
                    return "No memories found matching that query."

                lines = []
                for r in results:
                    meta = getattr(r, "meta", {}) or {}
                    cat = meta.get("category", "general")
                    lines.append(f"[{cat}] {r.content}")

                return "\n\n".join(lines)
            else:
                logger.warning("[UserMemory] Knowledge does not support search() method")
                return "Memory search is not available."
        except Exception as exc:
            logger.error("[UserMemory] Failed to search memory: %s", exc)
            return f"Failed to search memories: {exc}"


def make_user_memory_tools(knowledge: "Knowledge", user_id: str) -> UserMemoryTools:
    """Factory function to create UserMemoryTools bound to a user's knowledge."""
    return UserMemoryTools(knowledge=knowledge, user_id=user_id)