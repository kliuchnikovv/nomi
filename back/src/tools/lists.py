"""Agent tools for the user's named lists.

Bound to a ``user_id`` at build time (see AgentFactory._build_local_toolkits)
and delegating to ``src.storage.user_lists`` — the same store the ``/list``
slash command writes to. All methods return JSON strings, matching the
ProjectsTools convention.
"""

import json

from agno.tools import Toolkit
from agno.utils.log import logger

from src.storage import user_lists as _lists


class ListsTools(Toolkit):
    """Read and modify the user's named lists (groceries, todos, …)."""

    def __init__(self, user_id: str):
        super().__init__(name="lists")
        self._user_id = user_id
        self.register(self.get_lists)
        self.register(self.get_list)
        self.register(self.add_to_list)
        self.register(self.remove_from_list)
        self.register(self.delete_list)
        self.register(self.clear_list)

    async def get_lists(self) -> str:
        """List all of the user's named lists with their item counts.

        Use when the user asks what lists they have. Returns a JSON array of
        ``{"name", "items", "count"}`` objects.
        """
        try:
            return json.dumps(await _lists.get_lists(self._user_id), ensure_ascii=False)
        except Exception as exc:
            logger.warning("[ListsTools] get_lists failed: %s", exc)
            return json.dumps({"error": str(exc)})

    async def get_list(self, name: str) -> str:
        """Return the items of a single named list.

        Args:
            name: The list name (single word, e.g. "groceries").

        Returns JSON ``{"name", "items", "count"}`` or ``{"error": ...}``.
        """
        try:
            data = await _lists.get_list(self._user_id, name)
            if data is None:
                return json.dumps({"error": f"no list named '{name}'"})
            return json.dumps(data, ensure_ascii=False)
        except Exception as exc:
            logger.warning("[ListsTools] get_list failed: %s", exc)
            return json.dumps({"error": str(exc)})

    async def add_to_list(self, name: str, item: str) -> str:
        """Append an item to a named list, creating the list if it doesn't exist.

        Args:
            name: The list name (single word).
            item: The item text to add.

        Returns the updated list as JSON.
        """
        try:
            return json.dumps(
                await _lists.add_item(self._user_id, name, item), ensure_ascii=False
            )
        except Exception as exc:
            logger.warning("[ListsTools] add_to_list failed: %s", exc)
            return json.dumps({"error": str(exc)})

    async def remove_from_list(self, name: str, item_or_index: str) -> str:
        """Remove an item from a named list by 1-based index or exact text.

        Args:
            name: The list name (single word).
            item_or_index: Either a 1-based position (e.g. "2") or the item text.

        Returns JSON ``{"removed", "list"}`` or ``{"error": ...}``.
        """
        try:
            removed, data = await _lists.remove_item(
                self._user_id, name, str(item_or_index)
            )
            if data is None:
                return json.dumps({"error": f"no list named '{name}'"})
            if removed is None:
                return json.dumps(
                    {"error": f"nothing matching '{item_or_index}' in '{name}'"}
                )
            return json.dumps({"removed": removed, "list": data}, ensure_ascii=False)
        except Exception as exc:
            logger.warning("[ListsTools] remove_from_list failed: %s", exc)
            return json.dumps({"error": str(exc)})

    async def delete_list(self, name: str) -> str:
        """Delete a named list entirely.

        Args:
            name: The list name (single word).

        Returns JSON ``{"deleted": bool}``.
        """
        try:
            return json.dumps({"deleted": await _lists.delete_list(self._user_id, name)})
        except Exception as exc:
            logger.warning("[ListsTools] delete_list failed: %s", exc)
            return json.dumps({"error": str(exc)})

    async def clear_list(self, name: str) -> str:
        """Empty a named list's items while keeping the list.

        Args:
            name: The list name (single word).

        Returns JSON ``{"cleared": bool}``.
        """
        try:
            return json.dumps({"cleared": await _lists.clear_list(self._user_id, name)})
        except Exception as exc:
            logger.warning("[ListsTools] clear_list failed: %s", exc)
            return json.dumps({"error": str(exc)})
