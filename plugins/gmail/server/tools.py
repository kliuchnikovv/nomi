"""
Gmail tools for server-side plugin (no local storage).
Provides email reading and sending functionality.

NOTE: All methods are synchronous wrappers around async Gmail API calls.
This is required because the tool executor expects sync methods.
"""

import asyncio
import base64
import logging
import os
from typing import Any, Dict, List, Optional, Union

from agno.tools import Toolkit

logger = logging.getLogger(__name__)

# Maximum size for tool output strings (5MB, well below the 10MB API limit)
MAX_TOOL_OUTPUT_SIZE = 5 * 1024 * 1024  # 5 MB
TRUNCATION_NOTICE = "\n\n[TRUNCATED: content exceeded maximum size limit]"


class GmailTools(Toolkit):
    """Gmail integration tools for email management (server-side)."""

    def __init__(
        self,
        access_token: str,
        refresh_token: Optional[str] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        token_uri: Optional[str] = None,
        user_id: Optional[str] = None,
        account_email: Optional[str] = None,
    ):
        super().__init__(name="gmail_tools")
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.client_id = client_id
        self.client_secret = client_secret
        self.token_uri = token_uri or "https://oauth2.googleapis.com/token"
        self.user_id = user_id
        self.account_email = account_email
        self.base_url = "https://gmail.googleapis.com/gmail/v1"
        self.headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        }

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

    async def _persist_access_token(self, new_access_token: str) -> None:
        """Persist the refreshed access token via Go API."""
        api_url = os.getenv("GO_API_URL", "http://localhost:8080")
        if not self.user_id or not self.account_email or not api_url:
            logger.debug(
                "Skipping token persistence: missing user_id=%s, account_email=%s, or api_url",
                bool(self.user_id),
                bool(self.account_email),
            )
            return

        try:
            import aiohttp

            async with aiohttp.ClientSession() as session:
                url = f"{api_url}/api/oauth/gmail/update-token"
                body = {
                    "user_id": self.user_id,
                    "account_email": self.account_email,
                    "access_token": new_access_token,
                }
                async with session.post(
                    url, json=body, timeout=aiohttp.ClientTimeout(total=5)
                ) as resp:
                    if resp.status == 200:
                        logger.info(
                            "Persisted refreshed gmail token for user=%s",
                            self.user_id,
                        )
                    else:
                        text = await resp.text()
                        logger.warning(
                            "Failed to persist refreshed token: status=%d, body=%s",
                            resp.status,
                            text[:200],
                        )
        except Exception as e:
            logger.warning("Failed to persist refreshed token: %s", e)

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
                    response_text = await response.text()
                    if response.status != 200:
                        if "invalid_grant" in response_text:
                            logger.error(
                                "Gmail token expired (invalid_grant). "
                                "User must reconnect Gmail in Settings. "
                                "user_id=%s, account_email=%s",
                                self.user_id,
                                self.account_email,
                            )
                        else:
                            logger.error(
                                "Failed to refresh token: %s - %s",
                                response.status,
                                response_text,
                            )
                        return False

                    result = await response.json()
                    new_access_token = result.get("access_token")
                    if new_access_token:
                        self.access_token = new_access_token
                        self._update_headers()
                        logger.info("Successfully refreshed Gmail access token")
                        await self._persist_access_token(new_access_token)
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
                        raise Exception(
                            "Gmail: token expired. Please reconnect your Gmail in Settings."
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
                import concurrent.futures

                def run_in_thread():
                    new_loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(new_loop)
                    try:
                        return new_loop.run_until_complete(
                            self._async_make_request(method, endpoint, data)
                        )
                    finally:
                        new_loop.close()

                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(run_in_thread)
                    return future.result(timeout=30)
            else:
                return loop.run_until_complete(
                    self._async_make_request(method, endpoint, data)
                )
        except RuntimeError:
            return asyncio.run(self._async_make_request(method, endpoint, data))

    def search_emails(
        self, query: str, max_results: int = 10, include_body: bool = True
    ) -> List[Dict[str, Any]]:
        """Search emails in Gmail.

        Args:
            query: Gmail search query (same syntax as Gmail search box)
            max_results: Maximum number of emails to return
            include_body: Whether to fetch full body content (default: True).
                When False, uses format=metadata (smaller response).

        Returns:
            List of email objects with id, threadId, labels
        """
        params = f"?q={query}&maxResults={max_results}"
        result = self._make_request("GET", f"users/me/messages{params}")

        if not isinstance(result, dict) or "messages" not in result:
            return []

        messages = result.get("messages", [])
        full_messages = []

        for msg in messages[:max_results]:
            msg_id = msg.get("id")
            if msg_id:
                if include_body:
                    full_msg = self._make_request("GET", f"users/me/messages/{msg_id}")
                else:
                    full_msg = self._make_request(
                        "GET", f"users/me/messages/{msg_id}?format=metadata"
                    )
                if isinstance(full_msg, dict):
                    if include_body:
                        full_msg = self._truncate_if_needed(full_msg)
                    full_messages.append(full_msg)

        return full_messages

    def get_recent_emails(
        self, limit: int = 10, include_body: bool = False
    ) -> List[Dict[str, Any]]:
        """Get recent emails from the user's Gmail inbox.

        Args:
            limit: Maximum number of emails to return
            include_body: Whether to fetch full body content (default: False).
                When False, uses format=metadata (smaller response, recommended).

        Returns:
            List of email objects with id, threadId, snippet, headers
        """
        params = f"?maxResults={limit}"
        result = self._make_request("GET", f"users/me/messages{params}")

        if not isinstance(result, dict) or "messages" not in result:
            return []

        messages = result.get("messages", [])
        full_messages = []

        for msg in messages[:limit]:
            msg_id = msg.get("id")
            if msg_id:
                if include_body:
                    full_msg = self._make_request("GET", f"users/me/messages/{msg_id}")
                else:
                    full_msg = self._make_request(
                        "GET", f"users/me/messages/{msg_id}?format=metadata"
                    )
                if isinstance(full_msg, dict):
                    if include_body:
                        full_msg = self._truncate_if_needed(full_msg)
                    full_messages.append(full_msg)

        return full_messages

    def _truncate_if_needed(self, data: Any) -> Any:
        """Truncate large data structures to stay within API limits.

        Recursively processes dicts and lists, truncating string values
        that exceed the maximum size.
        """
        import json

        # Check current size
        try:
            size = len(json.dumps(data, ensure_ascii=False))
        except (TypeError, ValueError):
            return data

        if size <= MAX_TOOL_OUTPUT_SIZE:
            return data

        # Truncate string values in payload parts
        if isinstance(data, dict):
            payload = data.get("payload", {})
            if payload:
                parts = payload.get("parts", [])
                for part in parts:
                    if isinstance(part, dict):
                        body = part.get("body", {})
                        if isinstance(body, dict):
                            body_data = body.get("data", "")
                            if isinstance(body_data, str) and len(body_data) > 100000:
                                body["data"] = body_data[:100000] + TRUNCATION_NOTICE
                        body_snippet = body.get("snippet", "")
                        if isinstance(body_snippet, str) and len(body_snippet) > 5000:
                            body["snippet"] = body_snippet[:5000] + TRUNCATION_NOTICE

                # Also handle single part messages
                if "body" in payload and "data" in payload["body"]:
                    body_data = payload["body"]["data"]
                    if isinstance(body_data, str) and len(body_data) > 100000:
                        payload["body"]["data"] = body_data[:100000] + TRUNCATION_NOTICE

        # Final check - if still too large, serialize and truncate
        try:
            size = len(json.dumps(data, ensure_ascii=False))
        except (TypeError, ValueError):
            return data

        if size > MAX_TOOL_OUTPUT_SIZE:
            json_str = json.dumps(data, ensure_ascii=False)
            json_str = json_str[:MAX_TOOL_OUTPUT_SIZE] + TRUNCATION_NOTICE
            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                return {
                    "error": "Email content too large to display",
                    "truncated": True,
                }

        return data

    def get_email(
        self,
        message_id: str,
        include_body: bool = True,
        max_body_length: int = 50000,
    ) -> Dict[str, Any]:
        """Get email content by message ID.

        Args:
            message_id: Gmail message ID
            include_body: Whether to fetch the full body (default: True).
                When False, returns only headers and metadata (much smaller response).
            max_body_length: Maximum characters for body text when include_body=True.
                Body exceeding this limit will be truncated.

        Returns:
            Email object with headers, optionally body and attachments
        """
        if include_body:
            result = self._make_request("GET", f"users/me/messages/{message_id}")
        else:
            result = self._make_request(
                "GET", f"users/me/messages/{message_id}?format=metadata"
            )

        if not isinstance(result, dict):
            return {}

        if include_body:
            result = self._truncate_if_needed(result)

            # Also truncate plain text body at the top level for readability
            self._truncate_body_text(result, max_body_length)

        return result

    def _truncate_body_text(self, data: Dict[str, Any], max_length: int) -> None:
        """Truncate body text in-place to keep responses readable but bounded."""
        if not isinstance(data, dict):
            return

        payload = data.get("payload", {})
        if not isinstance(payload, dict):
            return

        def _truncate_parts(parts):
            for part in parts:
                if not isinstance(part, dict):
                    continue
                body = part.get("body", {})
                if isinstance(body, dict):
                    snippet = body.get("snippet", "")
                    if isinstance(snippet, str) and len(snippet) > max_length:
                        body["snippet"] = snippet[:max_length] + TRUNCATION_NOTICE

                    # Truncate attachment size info
                    if (
                        "size" in body
                        and isinstance(body["size"], int)
                        and body["size"] > max_body_length * 10
                    ):
                        body["data"] = TRUNCATION_NOTICE

                # Recurse into nested parts
                if "parts" in part:
                    _truncate_parts(part["parts"])

        if "parts" in payload:
            _truncate_parts(payload["parts"])

        # Single-part message
        if "body" in payload and isinstance(payload["body"], dict):
            body = payload["body"]
            snippet = body.get("snippet", "")
            if isinstance(snippet, str) and len(snippet) > max_length:
                body["snippet"] = snippet[:max_length] + TRUNCATION_NOTICE

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
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText

        msg = MIMEMultipart()
        msg["to"] = to
        msg["subject"] = subject

        if cc:
            msg["cc"] = cc
        if bcc:
            msg["bcc"] = bcc

        content_type = "html" if html else "plain"
        msg.attach(MIMEText(body, content_type))

        raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

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
        original_msg = self.get_email(message_id)
        if not original_msg:
            raise ValueError(f"Message {message_id} not found")

        thread_id = original_msg.get("threadId")
        if not thread_id:
            raise ValueError(f"Thread ID not found for message {message_id}")

        headers = original_msg.get("payload", {}).get("headers", [])
        headers_dict = {h["name"]: h["value"] for h in headers}

        references = headers_dict.get("References", "")
        message_id_header = headers_dict.get("Message-ID", "")
        subject = headers_dict.get("Subject", "")
        from_addr = headers_dict.get("From", "")

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

        if from_addr:
            msg["To"] = from_addr

        content_type = "html" if html else "plain"
        msg.attach(MIMEText(body, content_type))

        raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

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
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText

        msg = MIMEMultipart()
        msg["to"] = to
        msg["subject"] = subject

        if cc:
            msg["cc"] = cc
        if bcc:
            msg["bcc"] = bcc

        content_type = "html" if html else "plain"
        msg.attach(MIMEText(body, content_type))

        raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

        data = {"message": {"raw": raw_message}}
        result = self._make_request("POST", "users/me/drafts", data)

        return result if isinstance(result, dict) else {}


def build(params: Dict[str, Any]) -> Toolkit:
    """Build Gmail tools from parameters."""
    logger.info(
        "[GmailBuild] ==================== BUILDING GMAIL TOOLS ===================="
    )
    logger.info("[GmailBuild] params type: %s", type(params))
    logger.info(
        "[GmailBuild] params keys: %s",
        list(params.keys()) if isinstance(params, dict) else "not a dict",
    )

    masked_params = {}
    if isinstance(params, dict):
        for k, v in params.items():
            if (
                "token" in k.lower()
                or "secret" in k.lower()
                or "credential" in k.lower()
            ):
                masked_params[k] = (
                    f"*** ({type(v).__name__}, len={len(str(v)) if hasattr(v, '__len__') else 'N/A'})"
                )
            else:
                masked_params[k] = v
    logger.info("[GmailBuild] params (masked): %s", masked_params)

    has_creds_key = isinstance(params.get("creds"), dict)
    logger.info("[GmailBuild] Has 'creds' key: %s", has_creds_key)

    creds_data = params.get("creds", {}) if has_creds_key else params
    logger.info(
        "[GmailBuild] creds_data keys: %s",
        list(creds_data.keys()) if isinstance(creds_data, dict) else "not a dict",
    )

    access_token = (
        creds_data.get("access_token")
        or creds_data.get("token")
        or params.get("access_token")
        or params.get("gmail_access_token")
    )

    logger.info("[GmailBuild] Access token sources checked:")
    logger.info(
        "[GmailBuild]   creds_data.get('access_token'): %s",
        bool(creds_data.get("access_token")),
    )
    logger.info(
        "[GmailBuild]   creds_data.get('token'): %s", bool(creds_data.get("token"))
    )
    logger.info(
        "[GmailBuild]   params.get('access_token'): %s",
        bool(params.get("access_token")),
    )
    logger.info(
        "[GmailBuild]   params.get('gmail_access_token'): %s",
        bool(params.get("gmail_access_token")),
    )
    logger.info("[GmailBuild] Found access_token: %s", bool(access_token))

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
    user_id = creds_data.get("user_id") or params.get("user_id")
    account_email = (
        creds_data.get("account_email")
        or creds_data.get("display_name")
        or params.get("account_email")
        or params.get("display_name")
    )

    logger.info(
        "Building Gmail tools: access_token=%s, refresh_token=%s, client_id=%s, client_secret=%s, user_id=%s, account_email=%s",
        access_token[:20] if access_token else "EMPTY",
        refresh_token[:20] if refresh_token else "EMPTY",
        client_id[:20] if client_id else "EMPTY",
        "PRESENT" if client_secret else "EMPTY",
        user_id,
        account_email,
    )
    return GmailTools(
        access_token=access_token,
        refresh_token=refresh_token,
        client_id=client_id,
        client_secret=client_secret,
        token_uri=token_uri,
        user_id=user_id,
        account_email=account_email,
    )
