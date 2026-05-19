from __future__ import annotations

import logging
import os

import httpx
from agno.tools import Toolkit

logger = logging.getLogger(__name__)


class NotificationTools(Toolkit):
    """Tools for scheduling push notifications to the user."""

    def __init__(self, user_id: str):
        super().__init__(name="notification")
        self.user_id = user_id
        self._api_url = os.getenv("GO_API_URL", "http://localhost:8080")
        self._service_token = os.getenv("INTERNAL_SERVICE_TOKEN", "")
        self.register(self.schedule_notification)

    async def schedule_notification(
        self,
        title: str,
        body: str,
        scheduled_at: str,
        screen: str,
        screen_params: dict,
        notification_type: str = "proactive",
    ) -> str:
        """Schedule a push notification to the user at a future time.

        Use this when the user asks to be reminded about something, or when you
        proactively want to surface information at a relevant moment.

        Args:
            title: Short notification title (max ~50 chars).
            body: Notification body text.
            scheduled_at: ISO 8601 datetime string (e.g. "2026-05-20T15:00:00Z").
            screen: Target screen on tap — "chat" or "planner".
            screen_params: Route params for the screen. For "chat": {"chatId": "<uuid>"}.
                           For "planner": {"date": "YYYY-MM-DD"}.
            notification_type: "reminder" | "event" | "proactive".

        Returns:
            Confirmation string with notification ID.
        """
        payload = {
            "type": notification_type,
            "title": title,
            "body": body,
            "scheduled_at": scheduled_at,
            "deep_link": {"screen": screen, "params": screen_params},
        }

        headers: dict[str, str] = {
            "X-User-ID": self.user_id,
            "Content-Type": "application/json",
        }
        if self._service_token:
            headers["Authorization"] = f"Bearer {self._service_token}"

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{self._api_url}/api/notifications",
                    json=payload,
                    headers=headers,
                )
            if resp.status_code not in (200, 201):
                logger.warning(
                    "[NotificationTools] schedule_notification failed: %d %s",
                    resp.status_code,
                    resp.text,
                )
                return f"Failed to schedule notification: {resp.status_code}"

            data = resp.json()
            notification_id = data.get("ID", data.get("id", "unknown"))
            logger.info(
                "[NotificationTools] Notification scheduled: id=%s at=%s",
                notification_id,
                scheduled_at,
            )
            return f"Notification scheduled (id={notification_id}) for {scheduled_at}"

        except Exception as exc:
            logger.error("[NotificationTools] Error scheduling notification: %s", exc)
            return f"Error scheduling notification: {exc}"
