from __future__ import annotations

import logging
import os

import httpx
from agno.tools import Toolkit

logger = logging.getLogger(__name__)


class WatchTools(Toolkit):
    """Tools for the agent to set its own time-based self-reminders.

    Unlike a push notification, a watch reminder re-enters the proactive
    pipeline at the chosen time: the agent is re-invoked with the stored
    context and can pull fresh information before resurfacing it.
    """

    def __init__(self, user_id: str):
        super().__init__(name="watch")
        self.user_id = user_id
        self._api_url = os.getenv("GO_API_URL", "http://localhost:8080")
        self._service_token = os.getenv("INTERNAL_SERVICE_TOKEN", "")
        self.register(self.create_reminder)
        self.register(self.list_reminders)
        self.register(self.cancel_reminder)

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {
            "X-User-ID": self.user_id,
            "Content-Type": "application/json",
        }
        if self._service_token:
            headers["Authorization"] = f"Bearer {self._service_token}"
        return headers

    async def create_reminder(self, context: str, fire_at: str) -> str:
        """Set a self-reminder to resurface something at a future time.

        Use this when the user asks you to follow up later ("remind me to check
        the PR in 2 hours", "ping me about the call tomorrow at 9"). At the given
        time you will be re-invoked with `context` so you can pull fresh details
        and surface a helpful nudge.

        Args:
            context: What to resurface — write enough detail for your future self
                     to act on it without the original conversation.
            fire_at: ISO 8601 datetime string in the future (e.g. "2026-06-07T15:00:00Z").

        Returns:
            Confirmation string with the watch ID.
        """
        payload = {"context": context, "fire_at": fire_at}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{self._api_url}/api/watches",
                    json=payload,
                    headers=self._headers(),
                )
            if resp.status_code not in (200, 201):
                logger.warning(
                    "[WatchTools] create_reminder failed: %d %s",
                    resp.status_code,
                    resp.text,
                )
                return f"Failed to set reminder: {resp.status_code}"
            data = resp.json()
            watch_id = data.get("id", "unknown")
            return f"Reminder set (id={watch_id}) for {fire_at}"
        except Exception as exc:
            logger.error("[WatchTools] Error setting reminder: %s", exc)
            return f"Error setting reminder: {exc}"

    async def list_reminders(self) -> str:
        """List the user's active (pending) self-reminders.

        Returns:
            A human-readable list of pending reminders, or a note that there are none.
        """
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{self._api_url}/api/watches",
                    headers=self._headers(),
                )
            if resp.status_code != 200:
                return f"Failed to list reminders: {resp.status_code}"
            watches = resp.json().get("watches", [])
            if not watches:
                return "No active reminders."
            lines = [
                f"- {w.get('context', '?')} (id={w.get('id')}, at {w.get('fire_at')})"
                for w in watches
            ]
            return "Active reminders:\n" + "\n".join(lines)
        except Exception as exc:
            logger.error("[WatchTools] Error listing reminders: %s", exc)
            return f"Error listing reminders: {exc}"

    async def cancel_reminder(self, watch_id: str) -> str:
        """Cancel a pending self-reminder by its ID.

        Args:
            watch_id: The reminder ID returned by create_reminder / list_reminders.
        """
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.delete(
                    f"{self._api_url}/api/watches/{watch_id}",
                    headers=self._headers(),
                )
            if resp.status_code != 200:
                return f"Failed to cancel reminder: {resp.status_code}"
            return f"Reminder {watch_id} cancelled."
        except Exception as exc:
            logger.error("[WatchTools] Error cancelling reminder: %s", exc)
            return f"Error cancelling reminder: {exc}"
