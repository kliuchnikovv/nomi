from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from agno.tools import Toolkit

if TYPE_CHECKING:
    from agno.knowledge import Knowledge

logger = logging.getLogger(__name__)


class UserMemoryTools(Toolkit):
    def __init__(self, knowledge: "Knowledge", user_id: str):
        super().__init__(name="user_memory")
        self.knowledge = knowledge
        self.user_id = user_id
        self.register(self.remember_this)

    def remember_this(self, text: str) -> str:
        """Explicitly save important information to the user's long-term memory.

        Use when the user says "remember this", "save this for later", or similar.
        Also use for facts that are clearly important for future sessions:
        preferences, personal details, recurring tasks, important decisions.

        Args:
            text: The information to remember. Be specific and self-contained.

        Returns:
            Confirmation that the information was saved.
        """
        try:
            self.knowledge.insert(
                text_content=text,
                metadata={"user_id": self.user_id, "source": "user_memory"},
            )
            logger.info("[UserMemory] Saved: %s", text[:80])
            return f"Saved to memory: {text}"
        except Exception as exc:
            logger.error("[UserMemory] Failed: %s", exc)
            return f"Failed to save: {exc}"
