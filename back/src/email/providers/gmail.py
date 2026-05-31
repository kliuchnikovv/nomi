"""Gmail provider — wraps the Gmail REST API behind the EmailProvider interface.

Token refresh + persistence behaviour is ported from the original
``plugins/gmail/server/tools.py`` (refresh on 401, persist new access token via
the Go API ``/api/oauth/gmail/update-token`` endpoint).
"""

from __future__ import annotations

import base64
import logging
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

from src.email.filter import EmailFilter
from src.email.providers.base import EmailMessage, EmailProvider

logger = logging.getLogger(__name__)

DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token"
GMAIL_BASE_URL = "https://gmail.googleapis.com/gmail/v1"
MAX_BODY_LENGTH = 50000


class GmailProvider(EmailProvider):
    provider_name = "gmail"

    def __init__(
        self,
        account_id: str,
        display_name: str,
        access_token: str,
        refresh_token: str | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
        token_uri: str | None = None,
        user_id: str | None = None,
        account_email: str | None = None,
    ):
        self.account_id = account_id
        self.display_name = display_name or account_email or account_id[:8]
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.client_id = client_id
        self.client_secret = client_secret
        self.token_uri = token_uri or DEFAULT_TOKEN_URI
        self.user_id = user_id
        self.account_email = account_email or display_name

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Accept": "application/json",
        }

    # -- token refresh -------------------------------------------------------

    async def _persist_access_token(self, new_access_token: str) -> None:
        api_url = os.getenv("GO_API_URL", "http://localhost:8080")
        if not self.user_id or not self.account_email or not api_url:
            return
        try:
            import aiohttp

            url = f"{api_url}/api/oauth/gmail/update-token"
            body = {
                "user_id": self.user_id,
                "account_email": self.account_email,
                "access_token": new_access_token,
            }
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url, json=body, timeout=aiohttp.ClientTimeout(total=5)
                ) as resp:
                    if resp.status != 200:
                        text = await resp.text()
                        logger.warning(
                            "Failed to persist gmail token: %d %s",
                            resp.status,
                            text[:200],
                        )
        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to persist refreshed gmail token: %s", e)

    async def _refresh(self) -> bool:
        if not (self.refresh_token and self.client_id and self.client_secret):
            logger.warning("Gmail %s: cannot refresh, missing creds", self.display_name)
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
                async with session.post(self.token_uri, data=data) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        logger.error("Gmail token refresh failed: %s", body[:200])
                        return False
                    result = await resp.json()
                    token = result.get("access_token")
                    if not token:
                        return False
                    self.access_token = token
                    await self._persist_access_token(token)
                    return True
        except Exception as e:  # noqa: BLE001
            logger.error("Gmail token refresh exception: %s", e)
            return False

    async def _request(
        self, method: str, endpoint: str, data: dict | None = None
    ) -> Any:
        import aiohttp

        url = f"{GMAIL_BASE_URL}/{endpoint.lstrip('/')}"
        async with aiohttp.ClientSession() as session:
            async with session.request(
                method, url, headers=self._headers(), json=data
            ) as resp:
                if resp.status == 401 and await self._refresh():
                    async with session.request(
                        method, url, headers=self._headers(), json=data
                    ) as retry:
                        if retry.status >= 400:
                            raise Exception(
                                f"Gmail API error after refresh: {retry.status}"
                            )
                        return {} if retry.status == 204 else await retry.json()
                if resp.status >= 400:
                    text = await resp.text()
                    raise Exception(f"Gmail API error: {resp.status} - {text[:200]}")
                return {} if resp.status == 204 else await resp.json()

    # -- parsing -------------------------------------------------------------

    def _to_message(self, raw: dict[str, Any]) -> EmailMessage:
        payload = raw.get("payload", {}) or {}
        headers = {
            h.get("name", "").lower(): h.get("value", "")
            for h in payload.get("headers", []) or []
        }
        label_ids = raw.get("labelIds", []) or []
        to_field = headers.get("to", "")
        return EmailMessage(
            account_id=self.account_id,
            provider=self.provider_name,
            id=raw.get("id", ""),
            mailbox="INBOX",
            subject=headers.get("subject", ""),
            from_=headers.get("from", ""),
            to=[t.strip() for t in to_field.split(",") if t.strip()],
            date=headers.get("date", ""),
            snippet=raw.get("snippet", ""),
            flags=label_ids,
            unread="UNREAD" in label_ids,
            body=self._extract_body(payload) if payload.get("parts") or payload.get("body") else None,
        )

    def _extract_body(self, payload: dict[str, Any]) -> str | None:
        """Best-effort plain-text body extraction from a Gmail payload."""

        def walk(part: dict[str, Any]) -> str | None:
            mime = part.get("mimeType", "")
            body = part.get("body", {}) or {}
            data = body.get("data")
            if mime == "text/plain" and data:
                return _b64_decode(data)
            for sub in part.get("parts", []) or []:
                text = walk(sub)
                if text:
                    return text
            # Fallback to html if no plain text found at leaf
            if mime == "text/html" and data:
                return _b64_decode(data)
            return None

        text = walk(payload)
        if text and len(text) > MAX_BODY_LENGTH:
            text = text[:MAX_BODY_LENGTH] + "\n\n[truncated]"
        return text

    # -- EmailProvider -------------------------------------------------------

    async def search(self, filt: EmailFilter) -> list[EmailMessage]:
        query = filt.to_gmail_query()
        limit = max(1, min(filt.limit or 20, 50))
        params = f"?maxResults={limit}"
        if query:
            from urllib.parse import quote

            params += f"&q={quote(query)}"
        result = await self._request("GET", f"users/me/messages{params}")
        if not isinstance(result, dict):
            return []
        messages = result.get("messages", []) or []
        out: list[EmailMessage] = []
        for msg in messages[:limit]:
            mid = msg.get("id")
            if not mid:
                continue
            full = await self._request(
                "GET", f"users/me/messages/{mid}?format=metadata"
            )
            if isinstance(full, dict):
                out.append(self._to_message(full))
        return out

    async def get_message(self, msg_id: str, mailbox: str = "INBOX") -> EmailMessage:
        raw = await self._request("GET", f"users/me/messages/{msg_id}")
        if not isinstance(raw, dict):
            raise ValueError(f"Gmail message {msg_id} not found")
        return self._to_message(raw)

    async def list_mailboxes(self) -> list[str]:
        result = await self._request("GET", "users/me/labels")
        labels = result.get("labels", []) if isinstance(result, dict) else []
        return [lbl.get("name", "") for lbl in labels if lbl.get("name")]

    async def send(
        self,
        to: str,
        subject: str,
        body: str,
        cc: str | None = None,
        bcc: str | None = None,
        html: bool = False,
    ) -> str:
        raw = _build_mime(to, subject, body, cc, bcc, html)
        await self._request("POST", "users/me/messages/send", {"raw": raw})
        return f"Email sent to {to} from {self.display_name}"

    async def reply(
        self, msg_id: str, body: str, mailbox: str = "INBOX", html: bool = False
    ) -> str:
        original = await self._request("GET", f"users/me/messages/{msg_id}")
        if not isinstance(original, dict):
            raise ValueError(f"Message {msg_id} not found")
        thread_id = original.get("threadId")
        headers = {
            h["name"]: h["value"]
            for h in original.get("payload", {}).get("headers", [])
        }
        msg = MIMEMultipart()
        msg["Subject"] = headers.get("Subject", "")
        message_id_header = headers.get("Message-ID", "")
        msg["In-Reply-To"] = message_id_header
        refs = headers.get("References", "")
        msg["References"] = f"{refs} {message_id_header}".strip()
        if headers.get("From"):
            msg["To"] = headers["From"]
        msg.attach(MIMEText(body, "html" if html else "plain"))
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
        await self._request(
            "POST", "users/me/messages/send", {"raw": raw, "threadId": thread_id}
        )
        return f"Reply sent from {self.display_name}"

    async def create_draft(
        self,
        to: str,
        subject: str,
        body: str,
        cc: str | None = None,
        bcc: str | None = None,
        html: bool = False,
    ) -> str:
        raw = _build_mime(to, subject, body, cc, bcc, html)
        await self._request("POST", "users/me/drafts", {"message": {"raw": raw}})
        return f"Draft created in {self.display_name}"

    async def mark(
        self, msg_id: str, mailbox: str, status: str, remove: bool = False
    ) -> str:
        # Map status -> Gmail label modification.
        label_map = {"unread": "UNREAD", "read": "UNREAD", "flagged": "STARRED"}
        # status "read" means remove UNREAD; "unread" means add UNREAD.
        if status == "read":
            add, rem = [], ["UNREAD"]
        elif status == "unread":
            add, rem = ["UNREAD"], []
        else:
            label = label_map.get(status, status.upper())
            add, rem = ([], [label]) if remove else ([label], [])
        await self._request(
            "POST",
            f"users/me/messages/{msg_id}/modify",
            {"addLabelIds": add, "removeLabelIds": rem},
        )
        return f"Updated message {msg_id} in {self.display_name}"

    async def archive(self, msg_id: str, mailbox: str = "INBOX") -> str:
        await self._request(
            "POST",
            f"users/me/messages/{msg_id}/modify",
            {"removeLabelIds": ["INBOX"]},
        )
        return f"Archived message {msg_id} in {self.display_name}"

    async def delete(self, msg_id: str, mailbox: str = "INBOX") -> str:
        await self._request("POST", f"users/me/messages/{msg_id}/trash")
        return f"Trashed message {msg_id} in {self.display_name}"


def _b64_decode(data: str) -> str:
    try:
        return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode(
            "utf-8", errors="replace"
        )
    except Exception:  # noqa: BLE001
        return ""


def _build_mime(
    to: str,
    subject: str,
    body: str,
    cc: str | None,
    bcc: str | None,
    html: bool,
) -> str:
    msg = MIMEMultipart()
    msg["to"] = to
    msg["subject"] = subject
    if cc:
        msg["cc"] = cc
    if bcc:
        msg["bcc"] = bcc
    msg.attach(MIMEText(body, "html" if html else "plain"))
    return base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")


def build_from_credentials(
    account_id: str, display_name: str, creds: dict[str, Any]
) -> GmailProvider:
    """Construct a GmailProvider from a per-account credentials dict."""
    creds_data = creds.get("creds") if isinstance(creds.get("creds"), dict) else creds
    access_token = (
        creds_data.get("access_token")
        or creds_data.get("token")
        or creds.get("access_token")
    )
    if not access_token:
        raise ValueError("Gmail access_token is required")
    return GmailProvider(
        account_id=account_id,
        display_name=display_name,
        access_token=access_token,
        refresh_token=creds_data.get("refresh_token") or creds.get("refresh_token"),
        client_id=creds_data.get("client_id") or creds.get("client_id"),
        client_secret=creds_data.get("client_secret") or creds.get("client_secret"),
        token_uri=creds_data.get("token_uri") or creds.get("token_uri"),
        user_id=creds_data.get("user_id") or creds.get("user_id"),
        account_email=creds_data.get("account_email")
        or creds.get("account_email")
        or display_name,
    )
