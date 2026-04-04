"""
Google Calendar tools for hybrid plugin (server-side execution).
Provides calendar events reading and management functionality.
"""

import asyncio
import logging
from typing import Any, Dict, List, Optional, Union

from agno.tools import Toolkit

logger = logging.getLogger(__name__)


class CalendarTools(Toolkit):
    """Google Calendar integration tools (server-side)."""

    def __init__(
        self,
        access_token: str,
        refresh_token: Optional[str] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        token_uri: Optional[str] = None,
    ):
        super().__init__(name="calendar_tools")
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.client_id = client_id
        self.client_secret = client_secret
        self.token_uri = token_uri or "https://oauth2.googleapis.com/token"
        self.base_url = "https://www.googleapis.com/calendar/v3"
        self.headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        }

        # Register tools
        self.register(self.get_upcoming_events)
        self.register(self.create_event)
        self.register(self.list_calendars)

    def _update_headers(self):
        """Update headers with current access token."""
        self.headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Accept": "application/json",
        }

    async def _refresh_access_token(self) -> bool:
        """Refresh the access token using refresh token."""
        if not self.refresh_token or not self.client_id or not self.client_secret:
            logger.warning("Cannot refresh token: missing credentials")
            return False

        import aiohttp

        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "refresh_token": self.refresh_token,
            "grant_type": "refresh_token",
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(self.token_uri, data=data) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(
                            "Failed to refresh token: %s - %s",
                            response.status,
                            error_text,
                        )
                        return False

                    result = await response.json()
                    new_access_token = result.get("access_token")
                    if new_access_token:
                        self.access_token = new_access_token
                        self._update_headers()
                        logger.info(
                            "Successfully refreshed Google Calendar access token"
                        )
                        return True

                    logger.error("Refresh response missing access_token")
                    return False
        except Exception as e:
            logger.error("Exception while refreshing token: %s", e)
            return False

    async def _make_request(
        self,
        method: str,
        endpoint: str,
        data: Optional[Dict] = None,
        params: Optional[Dict] = None,
    ) -> Union[Dict[str, Any], List[Dict[str, Any]]]:
        """Make an authenticated request to Google Calendar API."""
        import aiohttp

        url = f"{self.base_url}/{endpoint.lstrip('/')}"

        async with aiohttp.ClientSession() as session:
            async with session.request(
                method, url, headers=self.headers, json=data, params=params
            ) as response:
                if response.status == 401:
                    logger.info("Received 401, attempting token refresh...")
                    if await self._refresh_access_token():
                        logger.info("Token refreshed, retrying request...")
                        async with session.request(
                            method, url, headers=self.headers, json=data, params=params
                        ) as retry_response:
                            if retry_response.status >= 400:
                                error_text = await retry_response.text()
                                raise Exception(
                                    f"Google Calendar API error after refresh: {retry_response.status} - {error_text}"
                                )
                            if retry_response.status == 204:
                                return {}
                            return await retry_response.json()
                    else:
                        error_text = await response.text()
                        raise Exception(
                            f"Google Calendar API error: 401 - Token refresh failed - {error_text}"
                        )

                if response.status >= 400:
                    error_text = await response.text()
                    raise Exception(
                        f"Google Calendar API error: {response.status} - {error_text}"
                    )

                if response.status == 204:
                    return {}

                return await response.json()

    async def get_upcoming_events(
        self, calendar_id: str = "primary", max_results: int = 10
    ) -> List[Dict[str, Any]]:
        """Get upcoming events from a calendar.

        Args:
            calendar_id: Calendar ID (default: "primary")
            max_results: Maximum number of events to return

        Returns:
            List of event objects
        """
        import datetime

        now = datetime.datetime.utcnow().isoformat() + "Z"

        params = {
            "timeMin": now,
            "maxResults": max_results,
            "singleEvents": "true",
            "orderBy": "startTime",
        }

        result = await self._make_request(
            "GET", f"calendars/{calendar_id}/events", params=params
        )

        if not isinstance(result, dict) or "items" not in result:
            return []

        return result.get("items", [])

    async def create_event(
        self,
        summary: str,
        start_time: str,
        end_time: str,
        calendar_id: str = "primary",
        description: Optional[str] = None,
        location: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a new calendar event.

        Args:
            summary: Event title
            start_time: ISO format start time (e.g. "2023-12-31T10:00:00Z")
            end_time: ISO format end time
            calendar_id: Calendar ID
            description: Event description
            location: Event location

        Returns:
            Created event details
        """
        data = {
            "summary": summary,
            "start": {"dateTime": start_time},
            "end": {"dateTime": end_time},
        }

        if description:
            data["description"] = description
        if location:
            data["location"] = location

        result = await self._make_request(
            "POST", f"calendars/{calendar_id}/events", data=data
        )
        return result if isinstance(result, dict) else {}

    async def list_calendars(self) -> List[Dict[str, Any]]:
        """List user's calendars.

        Returns:
            List of calendar metadata objects
        """
        result = await self._make_request("GET", "users/me/calendarList")

        if not isinstance(result, dict) or "items" not in result:
            return []

        return result.get("items", [])


def build(params: Dict[str, Any]) -> Toolkit:
    """Build Calendar tools from parameters."""
    logger.info("Calendar build() called with params keys: %s", list(params.keys()))
    logger.info("Calendar params.get('creds') type: %s", type(params.get("creds")))
    if isinstance(params.get("creds"), dict):
        logger.info("Calendar creds keys: %s", list(params["creds"].keys()))
        logger.info(
            "Calendar creds has access_token: %s", "access_token" in params["creds"]
        )

    creds_data = (
        params.get("creds", {}) if isinstance(params.get("creds"), dict) else params
    )

    raw_at = creds_data.get("access_token")
    raw_token = creds_data.get("token")
    raw_params_at = params.get("access_token")
    raw_cal_at = params.get("calendar_access_token")
    logger.info(
        "Calendar access_token lookups: creds_data.get='%.20s'(type=%s), token='%.20s'(type=%s), params.get='%.20s'(type=%s), calendar_access_token=%s",
        str(raw_at)[:20] if raw_at else "EMPTY",
        type(raw_at).__name__,
        str(raw_token)[:20] if raw_token else "EMPTY",
        type(raw_token).__name__,
        str(raw_params_at)[:20] if raw_params_at else "EMPTY",
        type(raw_params_at).__name__,
        str(raw_cal_at)[:20] if raw_cal_at else "EMPTY",
    )

    access_token = (
        creds_data.get("access_token")
        or creds_data.get("token")
        or params.get("access_token")
        or params.get("calendar_access_token")
    )

    if not access_token:
        raise ValueError("Calendar access_token is required")

    refresh_token = (
        creds_data.get("refresh_token")
        or params.get("refresh_token")
        or params.get("calendar_refresh_token")
    )

    client_id = creds_data.get("client_id") or params.get("client_id")
    client_secret = creds_data.get("client_secret") or params.get("client_secret")
    token_uri = creds_data.get("token_uri") or params.get("token_uri")

    logger.info("Building Calendar tools with access token")
    return CalendarTools(
        access_token=access_token,
        refresh_token=refresh_token,
        client_id=client_id,
        client_secret=client_secret,
        token_uri=token_uri,
    )
