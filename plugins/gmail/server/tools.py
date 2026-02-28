"""
Gmail tools for server-side plugin (no local storage).
Provides email reading and sending functionality.

NOTE: All methods are synchronous wrappers around async Gmail API calls.
This is required because the tool executor expects sync methods.
"""

import asyncio
import base64
import logging
from typing import Any, Dict, List, Optional, Union

from agno.tools import Toolkit

logger = logging.getLogger(__name__)


class GmailTools(Toolkit):
    """Gmail integration tools for email management (server-side)."""

    def __init__(
        self,
        access_token: str,
        refresh_token: Optional[str] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        token_uri: Optional[str] = None,
    ):
        super().__init__(name="gmail_tools")
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.client_id = client_id
        self.client_secret = client_secret
        self.token_uri = token_uri or "https://oauth2.googleapis.com/token"
        self.base_url = "https://gmail.googleapis.com/gmail/v1"
        self.headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        }

        # Register tools
        self.register(self.get_recent_emails)
        self.register(self.search_emails)
        self.register(self.get_email)
        self.register(self.send_email)
        self.register(self.reply_email)
        self.register(self.create_draft)

    def _update_headers(self):
        """Update headers with current access token."""
        self.headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Accept": "application/json",
        }

    async def _async_refresh_access_token(self) -> bool:
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
                        logger.info("Successfully refreshed Gmail access token")
                        return True

                    logger.error("Refresh response missing access_token")
                    return False
        except Exception as e:
            logger.error("Exception while refreshing token: %s", e)
            return False

    async def _async_make_request(
        self, method: str, endpoint: str, data: Optional[Dict] = None
    ) -> Union[Dict[str, Any], List[Dict[str, Any]]]:
        """Make an authenticated request to Gmail API."""
        import aiohttp

        url = f"{self.base_url}/{endpoint.lstrip('/')}"

        async with aiohttp.ClientSession() as session:
            async with session.request(
                method, url, headers=self.headers, json=data
            ) as response:
                if response.status == 401:
                    logger.info("Received 401, attempting token refresh...")
                    if await self._async_refresh_access_token():
                        logger.info("Token refreshed, retrying request...")
                        async with session.request(
                            method, url, headers=self.headers, json=data
                        ) as retry_response:
                            if retry_response.status >= 400:
                                error_text = await retry_response.text()
                                raise Exception(
                                    f"Gmail API error after refresh: {retry_response.status} - {error_text}"
                                )
                            if retry_response.status == 204:
                                return {}
                            return await retry_response.json()
                    else:
                        error_text = await response.text()
                        raise Exception(
                            f"Gmail API error: 401 - Token refresh failed - {error_text}"
                        )

                if response.status >= 400:
                    error_text = await response.text()
                    raise Exception(
                        f"Gmail API error: {response.status} - {error_text}"
                    )

                if response.status == 204:
                    return {}

                return await response.json()

    def _make_request(
        self, method: str, endpoint: str, data: Optional[Dict] = None
    ) -> Union[Dict[str, Any], List[Dict[str, Any]]]:
        """Sync wrapper for async_make_request."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # We're in an async context, need to create new loop
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    result = loop.run_until_complete(
                        self._async_make_request(method, endpoint, data)
                    )
                    return result
                finally:
                    loop.close()
            else:
                return loop.run_until_complete(
                    self._async_make_request(method, endpoint, data)
                )
        except RuntimeError:
            # No event loop, create one
            return asyncio.run(self._async_make_request(method, endpoint, data))

    def search_emails(
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
        result = self._make_request("GET", f"users/me/messages{params}")

        if not isinstance(result, dict) or "messages" not in result:
            return []

        # Get full message details for each
        messages = result.get("messages", [])
        full_messages = []

        for msg in messages[:max_results]:
            msg_id = msg.get("id")
            if msg_id:
                full_msg = self._make_request(
                    "GET", f"users/me/messages/{msg_id}"
                )
                if isinstance(full_msg, dict):
                    full_messages.append(full_msg)

        return full_messages

    def get_recent_emails(
        self, limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Get recent emails from the user's Gmail inbox.

        Args:
            limit: Maximum number of emails to return

        Returns:
            List of email objects with id, threadId, snippet, headers
        """
        params = f"?maxResults={limit}"
        result = self._make_request("GET", f"users/me/messages{params}")

        if not isinstance(result, dict) or "messages" not in result:
            return []

        # Get message details in lightweight format (metadata only)
        messages = result.get("messages", [])
        full_messages = []

        for msg in messages[:limit]:
            msg_id = msg.get("id")
            if msg_id:
                # Use metadata format for faster loading
                full_msg = self._make_request(
                    "GET", f"users/me/messages/{msg_id}?format=metadata"
                )
                if isinstance(full_msg, dict):
                    full_messages.append(full_msg)

        return full_messages

    def get_email(self, message_id: str) -> Dict[str, Any]:
        """Get full email content by message ID.

        Args:
            message_id: Gmail message ID

        Returns:
            Full email object with headers, body, attachments
        """
        result = self._make_request("GET", f"users/me/messages/{message_id}")
        return result if isinstance(result, dict) else {}

    def send_email(
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
        result = self._make_request("POST", "users/me/messages/send", data)

        return result if isinstance(result, dict) else {}

    def reply_email(
        self,
        message_id: str,
        body: str,
        html: bool = False,
        cc: Optional[str] = None,
        bcc: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Reply to an existing email.

        Args:
            message_id: Gmail message ID to reply to
            body: Reply body
            html: Whether body is HTML
            cc: CC recipients (comma-separated)
            bcc: BCC recipients (comma-separated)

        Returns:
            Sent message details
        """
        # Get original message to retrieve thread ID and headers
        original_msg = self.get_email(message_id)
        if not original_msg:
            raise ValueError(f"Message {message_id} not found")

        thread_id = original_msg.get("threadId")
        if not thread_id:
            raise ValueError(f"Thread ID not found for message {message_id}")

        # Extract headers from original message
        headers = original_msg.get("payload", {}).get("headers", [])
        headers_dict = {h["name"]: h["value"] for h in headers}

        # Determine references and in-reply-to
        references = headers_dict.get("References", "")
        message_id_header = headers_dict.get("Message-ID", "")
        subject = headers_dict.get("Subject", "")
        from_addr = headers_dict.get("From", "")

        # Build reply email
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText

        msg = MIMEMultipart()
        msg["Subject"] = subject
        msg["In-Reply-To"] = message_id_header
        if references:
            msg["References"] = f"{references} {message_id_header}"
        else:
            msg["References"] = message_id_header

        if cc:
            msg["cc"] = cc
        if bcc:
            msg["bcc"] = bcc

        # Reply to original sender
        if from_addr:
            msg["To"] = from_addr

        # Add body
        content_type = "html" if html else "plain"
        msg.attach(MIMEText(body, content_type))

        # Encode to base64 URL-safe
        raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

        # Send via API
        data = {"raw": raw_message, "threadId": thread_id}
        result = self._make_request("POST", "users/me/messages/send", data)

        return result if isinstance(result, dict) else {}

    def create_draft(
        self,
        to: str,
        subject: str,
        body: str,
        cc: Optional[str] = None,
        bcc: Optional[str] = None,
        html: bool = False,
    ) -> Dict[str, Any]:
        """Create a draft email.

        Args:
            to: Recipient email address
            subject: Email subject
            body: Email body
            cc: CC recipients (comma-separated)
            bcc: BCC recipients (comma-separated)
            html: Whether body is HTML

        Returns:
            Created draft details with id
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

        # Create draft via API
        data = {"message": {"raw": raw_message}}
        result = self._make_request("POST", "users/me/drafts", data)

        return result if isinstance(result, dict) else {}


def build(params: Dict[str, Any]) -> Toolkit:
    """Build Gmail tools from parameters.

    Expected params:
        - access_token: Gmail OAuth access token
        - refresh_token: Optional refresh token
        - client_id: Optional client ID for token refresh
        - client_secret: Optional client secret for token refresh
        - token_uri: Optional token URI for token refresh

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

    client_id = creds_data.get("client_id") or params.get("client_id")
    client_secret = creds_data.get("client_secret") or params.get("client_secret")
    token_uri = creds_data.get("token_uri") or params.get("token_uri")

    logger.info("Building Gmail tools with access token")
    return GmailTools(
        access_token=access_token,
        refresh_token=refresh_token,
        client_id=client_id,
        client_secret=client_secret,
        token_uri=token_uri,
    )
