from typing import Any

from agno.tools import Toolkit
from agno.utils.log import logger


class PlanningTools(Toolkit):
    """Tools for planning and scheduling tasks."""

    def __init__(self):
        super().__init__(name="planning")
        self.client_tool_runner: Any = None
        self.register(self.patch_plan_document)

    async def patch_plan_document(
        self,
        patches: list[dict],
        summary: str,
    ) -> str:
        """Apply changes to the user's daily plan document.

        Use this tool to update tasks with times, locations, notes, or reorganize them.
        The changes will be applied immediately to the planner screen.

        Args:
            patches (list[dict]): List of patch operations to apply. Each patch is a dict with:
                - op (str): Operation type: "add_chip", "remove_chip", "update_chip", "add_item", "remove_item", "update_item"
                - For add_chip: {"op": "add_chip", "item_id": "...", "chip": {"type": "time|location|note", "value": "...", "id": "..."}}
                - For remove_chip: {"op": "remove_chip", "item_id": "...", "chip_id": "..."}
                - For update_chip: {"op": "update_chip", "item_id": "...", "chip": {...}}
                - For update_item: {"op": "update_item", "item_id": "...", "changes": {...}}
                - For move_to_date: {"op": "move_to_date", "item_id": "...", "target_date": "YYYY-MM-DD"}
                - For reorder_items: {"op": "reorder_items", "ids": ["id1", "id2", ...]}
                  — Reorders items to match the given array (ascending by start time). Use as the final patch after all chips are assigned.

                Chip types:
                - time: "09:00-10:00", "14:30", "morning", "afternoon"
                - location: "home", "office", "café", "gym", etc.
                - note: any contextual information (transit time, reminders, etc.)

            summary (str): Brief summary of changes for the user (e.g., "Added times and optimized order").

        Returns:
            str: Confirmation message.

        Examples:
            >>> await patch_plan_document(
            ...     patches=[
            ...         {"op": "add_chip", "item_id": "abc123", "chip": {"type": "time", "value": "09:00-10:00", "id": "1"}},
            ...         {"op": "add_chip", "item_id": "abc123", "chip": {"type": "location", "value": "home", "id": "2"}},
            ...     ],
            ...     summary="Added time and location for morning task"
            ... )
        """
        if not self.client_tool_runner:
            logger.warning("[PlanningTools] client_tool_runner not available")
            return "Error: Cannot update plan - client_tool_runner not available"

        logger.info(f"[PlanningTools] Applying {len(patches)} patches: {summary}")

        params = {
            "patches": patches,
            "summary": summary,
        }

        try:
            result = await self.client_tool_runner("patch_plan_document", "edit", params)
            logger.info(f"[PlanningTools] Patches applied: {result}")
            return f"Applied {len(patches)} changes to your plan"
        except Exception as e:
            logger.error(f"[PlanningTools] Failed to apply patches: {e}", exc_info=True)
            return f"Error: Failed to apply changes - {str(e)}"
