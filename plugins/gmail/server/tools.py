"""
Gmail tools for hybrid plugin (server-side execution).
Provides email reading and sending functionality.

NOTE: This is the SERVER-SIDE component of the hybrid plugin.
The client-side executor.ts handles UI interactions and local caching.
"""

import asyncio
import base64
import logging
from typing import Any, Dict, List, Optional, Union

from agno.tools import Toolkit

logger = logging.getLogger(__name__)


class GmailTools(Toolkit):
    """Gmail integration tools for email management (server-side)."""

    def __init__(self, access_token: str, refresh_token: Optional[str] = None):
        super().__init__(name="gmail_tools")
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.base_url = "https://gmail.googleapis.com/gmail/v1"
        self.headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        }

        # Register tools
        self.register(self.search_emails)
        self.register(self.get_email)
        self.register(self.send_email)

    async def _make_request(
        self, method: str, endpoint: str, data: Optional[Dict] = None
    ) -> Union[Dict[str, Any], List[Dict[str, Any]]]:
        """Make an authenticated request to Gmail API."""
        import aiohttp

        url = f"{self.base_url}/{endpoint.lstrip('/')}"

        async with aiohttp.ClientSession() as session:
            async with session.request(
                method, url, headers=self.headers, json=data
            ) as response:
                if response.status >= 400:
                    error_text = await response.text()
                    raise Exception(
                        f"Gmail API error: {response.status} - {error_text}"
                    )

                if response.status == 204:
                    return {}

                return await response.json()

    async def search_emails(
        self, query: str, max_results: int = 10
    ) -> List[Dict[str, Any]]:
        """Search emails in Gmail.

        Args:
            query: Gmail search query (same syntax as Gmail search box)
            max_results: Maximum number of emails to return

        Returns:
            List of email objects with id, threadId, labels
        """
        # First get message list
        params = f"?q={query}&maxResults={max_results}"
        result = await self._make_request("GET", f"users/me/messages{params}")

        if not isinstance(result, dict) or "messages" not in result:
            return []

        # Get full message details for each
        messages = result.get("messages", [])
        full_messages = []

        for msg in messages[:max_results]:
            msg_id = msg.get("id")
            if msg_id:
                full_msg = await self._make_request(
                    "GET", f"users/me/messages/{msg_id}"
                )
                if isinstance(full_msg, dict):
                    full_messages.append(full_msg)

        return full_messages

    async def get_email(self, message_id: str) -> Dict[str, Any]:
        """Get full email content by message ID.

        Args:
            message_id: Gmail message ID

        Returns:
            Full email object with headers, body, attachments
        """
        result = await self._make_request("GET", f"users/me/messages/{message_id}")
        return result if isinstance(result, dict) else {}

    async def send_email(
        self,
        to: str,
        subject: str,
        body: str,
        cc: Optional[str] = None,
        bcc: Optional[str] = None,
        html: bool = False,
    ) -> Dict[str, Any]:
        """Send an email from the user's Gmail account.

        Args:
            to: Recipient email address
            subject: Email subject
            body: Email body
            cc: CC recipients (comma-separated)
            bcc: BCC recipients (comma-separated)
            html: Whether body is HTML

        Returns:
            Sent message details
        """
        # Build email content
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText

        msg = MIMEMultipart()
        msg["to"] = to
        msg["subject"] = subject

        if cc:
            msg["cc"] = cc
        if bcc:
            msg["bcc"] = bcc

        # Add body
        content_type = "html" if html else "plain"
        msg.attach(MIMEText(body, content_type))

        # Encode to base64 URL-safe
        raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

        # Send via API
        data = {"raw": raw_message}
        result = await self._make_request("POST", "users/me/messages/send", data)

        return result if isinstance(result, dict) else {}


def build(params: Dict[str, Any]) -> Toolkit:
    """Build Gmail tools from parameters.

    Expected params:
        - access_token: Gmail OAuth access token
        - refresh_token: Optional refresh token

    Args:
        params: Configuration parameters

    Returns:
        Configured GmailTools instance
    """
    # Support nested credentials
    creds_data = (
        params.get("creds", {}) if isinstance(params.get("creds"), dict) else params
    )

    access_token = (
        creds_data.get("access_token")
        or creds_data.get("token")
        or params.get("access_token")
        or params.get("gmail_access_token")
    )

    if not access_token:
        raise ValueError("Gmail access_token is required")

    refresh_token = (
        creds_data.get("refresh_token")
        or params.get("refresh_token")
        or params.get("gmail_refresh_token")
    )

    logger.info("Building Gmail tools with access token")
    return GmailTools(access_token=access_token, refresh_token=refresh_token)
