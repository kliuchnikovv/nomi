"""IMAP/SMTP provider — runs the mail protocol on the server.

Implemented with the stdlib ``imaplib``/``smtplib`` wrapped in
``asyncio.to_thread`` so the blocking socket work never stalls the event loop.
A fresh connection is opened per operation (mail ops are infrequent; this keeps
the code stateless and avoids cross-task connection sharing).

Mirrors the behaviour of the device-side ``IOSMailManager.swift`` it replaces.
"""

from __future__ import annotations

import asyncio
import email
import email.utils
import imaplib
import logging
import smtplib
from email.header import decode_header, make_header
from email.message import Message
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

from src.email.filter import EmailFilter, auto_detect_imap_config
from src.email.providers.base import EmailMessage, EmailProvider

logger = logging.getLogger(__name__)

MAX_BODY_LENGTH = 50000
_FETCH_HEADERS = "(FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])"


def _decode(value: str | None) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:  # noqa: BLE001
        return value


class ImapProvider(EmailProvider):
    provider_name = "imap"

    def __init__(
        self,
        account_id: str,
        display_name: str,
        username: str,
        password: str,
        imap_host: str,
        imap_port: int = 993,
        imap_use_tls: bool = True,
        smtp_host: str | None = None,
        smtp_port: int = 465,
        smtp_use_tls: bool = True,
    ):
        self.account_id = account_id
        self.display_name = display_name or username
        self.username = username
        self.password = password
        self.imap_host = imap_host
        self.imap_port = imap_port
        self.imap_use_tls = imap_use_tls
        self.smtp_host = smtp_host or imap_host.replace("imap", "smtp")
        self.smtp_port = smtp_port
        self.smtp_use_tls = smtp_use_tls

    # -- connection helpers (sync; run inside to_thread) ---------------------

    def _imap_connect(self) -> imaplib.IMAP4:
        if self.imap_use_tls:
            conn: imaplib.IMAP4 = imaplib.IMAP4_SSL(self.imap_host, self.imap_port)
        else:
            conn = imaplib.IMAP4(self.imap_host, self.imap_port)
            conn.starttls()
        conn.login(self.username, self.password)
        return conn

    @staticmethod
    def _close(conn: imaplib.IMAP4) -> None:
        try:
            conn.logout()
        except Exception:  # noqa: BLE001
            pass

    # -- sync workers --------------------------------------------------------

    def _sync_search(self, criteria: str, mailbox: str, limit: int) -> list[EmailMessage]:
        conn = self._imap_connect()
        try:
            conn.select(mailbox, readonly=True)
            typ, data = conn.uid("SEARCH", None, criteria)
            if typ != "OK" or not data or not data[0]:
                return []
            uids = data[0].split()
            uids = uids[-limit:][::-1]  # most recent first
            messages: list[EmailMessage] = []
            for uid in uids:
                uid_s = uid.decode() if isinstance(uid, bytes) else str(uid)
                typ, fdata = conn.uid("FETCH", uid_s, _FETCH_HEADERS)
                if typ != "OK" or not fdata:
                    continue
                messages.append(self._parse_header_fetch(uid_s, mailbox, fdata))
            return messages
        finally:
            self._close(conn)

    def _parse_header_fetch(
        self, uid: str, mailbox: str, fdata: list
    ) -> EmailMessage:
        flags: list[str] = []
        raw_headers = b""
        for part in fdata:
            if isinstance(part, tuple) and len(part) == 2:
                meta, body = part
                if isinstance(meta, bytes):
                    flags = [
                        f.decode() if isinstance(f, bytes) else str(f)
                        for f in imaplib.ParseFlags(meta)
                    ]
                if isinstance(body, bytes):
                    raw_headers = body
            elif isinstance(part, bytes):
                parsed = imaplib.ParseFlags(part)
                if parsed:
                    flags = [
                        f.decode() if isinstance(f, bytes) else str(f) for f in parsed
                    ]
        msg = email.message_from_bytes(raw_headers) if raw_headers else Message()
        to_field = _decode(msg.get("To", ""))
        return EmailMessage(
            account_id=self.account_id,
            provider=self.provider_name,
            id=uid,
            mailbox=mailbox,
            subject=_decode(msg.get("Subject", "")),
            from_=_decode(msg.get("From", "")),
            to=[t.strip() for t in to_field.split(",") if t.strip()],
            date=msg.get("Date", ""),
            snippet="",
            flags=flags,
            unread="\\Seen" not in flags,
        )

    def _sync_get_message(self, uid: str, mailbox: str) -> EmailMessage:
        conn = self._imap_connect()
        try:
            conn.select(mailbox, readonly=True)
            typ, fdata = conn.uid("FETCH", uid, "(FLAGS BODY.PEEK[])")
            if typ != "OK" or not fdata:
                raise ValueError(f"IMAP message {uid} not found in {mailbox}")
            flags: list[str] = []
            raw = b""
            for part in fdata:
                if isinstance(part, tuple) and len(part) == 2:
                    meta, body = part
                    if isinstance(meta, bytes):
                        flags = [
                            f.decode() if isinstance(f, bytes) else str(f)
                            for f in imaplib.ParseFlags(meta)
                        ]
                    if isinstance(body, bytes):
                        raw = body
            msg = email.message_from_bytes(raw)
            to_field = _decode(msg.get("To", ""))
            return EmailMessage(
                account_id=self.account_id,
                provider=self.provider_name,
                id=uid,
                mailbox=mailbox,
                subject=_decode(msg.get("Subject", "")),
                from_=_decode(msg.get("From", "")),
                to=[t.strip() for t in to_field.split(",") if t.strip()],
                date=msg.get("Date", ""),
                snippet="",
                flags=flags,
                unread="\\Seen" not in flags,
                body=_extract_text(msg),
            )
        finally:
            self._close(conn)

    def _sync_store(self, uid: str, mailbox: str, flag: str, remove: bool) -> None:
        conn = self._imap_connect()
        try:
            conn.select(mailbox)
            op = "-FLAGS" if remove else "+FLAGS"
            conn.uid("STORE", uid, op, f"({flag})")
        finally:
            self._close(conn)

    def _sync_move(self, uid: str, mailbox: str, destination: str) -> None:
        conn = self._imap_connect()
        try:
            conn.select(mailbox)
            # Prefer the MOVE extension; fall back to COPY + delete.
            typ, _ = conn.uid("MOVE", uid, destination)
            if typ != "OK":
                conn.uid("COPY", uid, destination)
                conn.uid("STORE", uid, "+FLAGS", "(\\Deleted)")
                conn.expunge()
        finally:
            self._close(conn)

    def _sync_delete(self, uid: str, mailbox: str) -> None:
        conn = self._imap_connect()
        try:
            conn.select(mailbox)
            conn.uid("STORE", uid, "+FLAGS", "(\\Deleted)")
            conn.expunge()
        finally:
            self._close(conn)

    def _sync_list_mailboxes(self) -> list[str]:
        conn = self._imap_connect()
        try:
            typ, data = conn.list()
            if typ != "OK" or not data:
                return []
            names: list[str] = []
            for line in data:
                if not isinstance(line, bytes):
                    continue
                decoded = line.decode(errors="replace")
                # Format: (\HasNoChildren) "/" "INBOX"
                if '"' in decoded:
                    names.append(decoded.rsplit('"', 2)[-2])
            return names
        finally:
            self._close(conn)

    def _sync_get_reply_headers(self, uid: str, mailbox: str) -> dict[str, str]:
        conn = self._imap_connect()
        try:
            conn.select(mailbox, readonly=True)
            typ, fdata = conn.uid(
                "FETCH",
                uid,
                "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT MESSAGE-ID REFERENCES)])",
            )
            raw = b""
            if typ == "OK" and fdata:
                for part in fdata:
                    if isinstance(part, tuple) and len(part) == 2 and isinstance(
                        part[1], bytes
                    ):
                        raw = part[1]
            msg = email.message_from_bytes(raw)
            return {
                "from": _decode(msg.get("From", "")),
                "subject": _decode(msg.get("Subject", "")),
                "message_id": msg.get("Message-ID", ""),
                "references": msg.get("References", ""),
            }
        finally:
            self._close(conn)

    def _sync_send(self, mime: MIMEMultipart, recipients: list[str]) -> None:
        if self.smtp_use_tls:
            server: smtplib.SMTP = smtplib.SMTP_SSL(self.smtp_host, self.smtp_port)
        else:
            server = smtplib.SMTP(self.smtp_host, self.smtp_port)
            server.starttls()
        try:
            server.login(self.username, self.password)
            server.sendmail(self.username, recipients, mime.as_string())
        finally:
            try:
                server.quit()
            except Exception:  # noqa: BLE001
                pass

    # -- EmailProvider (async) ----------------------------------------------

    async def search(self, filt: EmailFilter) -> list[EmailMessage]:
        criteria = filt.to_imap_criteria()
        limit = max(1, min(filt.limit or 20, 100))
        mailbox = filt.mailbox or "INBOX"
        return await asyncio.to_thread(self._sync_search, criteria, mailbox, limit)

    async def get_message(self, msg_id: str, mailbox: str = "INBOX") -> EmailMessage:
        return await asyncio.to_thread(self._sync_get_message, msg_id, mailbox)

    async def list_mailboxes(self) -> list[str]:
        return await asyncio.to_thread(self._sync_list_mailboxes)

    async def send(
        self,
        to: str,
        subject: str,
        body: str,
        cc: str | None = None,
        bcc: str | None = None,
        html: bool = False,
    ) -> str:
        mime = MIMEMultipart()
        mime["From"] = self.username
        mime["To"] = to
        mime["Subject"] = subject
        if cc:
            mime["Cc"] = cc
        mime.attach(MIMEText(body, "html" if html else "plain"))
        recipients = _recipients(to, cc, bcc)
        await asyncio.to_thread(self._sync_send, mime, recipients)
        return f"Email sent to {to} from {self.display_name}"

    async def reply(
        self, msg_id: str, body: str, mailbox: str = "INBOX", html: bool = False
    ) -> str:
        headers = await asyncio.to_thread(
            self._sync_get_reply_headers, msg_id, mailbox
        )
        to_addr = email.utils.parseaddr(headers.get("from", ""))[1]
        if not to_addr:
            raise ValueError(f"Could not determine reply recipient for {msg_id}")
        subject = headers.get("subject", "")
        if subject and not subject.lower().startswith("re:"):
            subject = f"Re: {subject}"
        mime = MIMEMultipart()
        mime["From"] = self.username
        mime["To"] = to_addr
        mime["Subject"] = subject
        if headers.get("message_id"):
            mime["In-Reply-To"] = headers["message_id"]
            refs = headers.get("references", "")
            mime["References"] = f"{refs} {headers['message_id']}".strip()
        mime.attach(MIMEText(body, "html" if html else "plain"))
        await asyncio.to_thread(self._sync_send, mime, [to_addr])
        return f"Reply sent to {to_addr} from {self.display_name}"

    async def mark(
        self, msg_id: str, mailbox: str, status: str, remove: bool = False
    ) -> str:
        if status == "read":
            flag, rem = "\\Seen", False
        elif status == "unread":
            flag, rem = "\\Seen", True
        elif status == "flagged":
            flag, rem = "\\Flagged", remove
        else:
            flag, rem = status, remove
        await asyncio.to_thread(self._sync_store, msg_id, mailbox, flag, rem)
        return f"Updated message {msg_id} in {self.display_name}"

    async def move(self, msg_id: str, mailbox: str, destination: str) -> str:
        await asyncio.to_thread(self._sync_move, msg_id, mailbox, destination)
        return f"Moved message {msg_id} to {destination} in {self.display_name}"

    async def archive(self, msg_id: str, mailbox: str = "INBOX") -> str:
        await asyncio.to_thread(self._sync_move, msg_id, mailbox, "Archive")
        return f"Archived message {msg_id} in {self.display_name}"

    async def delete(self, msg_id: str, mailbox: str = "INBOX") -> str:
        await asyncio.to_thread(self._sync_delete, msg_id, mailbox)
        return f"Deleted message {msg_id} in {self.display_name}"


def _recipients(to: str, cc: str | None, bcc: str | None) -> list[str]:
    out: list[str] = []
    for field_val in (to, cc, bcc):
        if field_val:
            out.extend(a.strip() for a in field_val.split(",") if a.strip())
    return out


def _extract_text(msg: Message) -> str | None:
    """Extract a plain-text (or HTML fallback) body from a parsed message."""
    text: str | None = None
    html: str | None = None
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            if part.get("Content-Disposition", "").startswith("attachment"):
                continue
            if ctype == "text/plain" and text is None:
                text = _payload_text(part)
            elif ctype == "text/html" and html is None:
                html = _payload_text(part)
    else:
        if msg.get_content_type() == "text/html":
            html = _payload_text(msg)
        else:
            text = _payload_text(msg)
    result = text or html
    if result and len(result) > MAX_BODY_LENGTH:
        result = result[:MAX_BODY_LENGTH] + "\n\n[truncated]"
    return result


def _payload_text(part: Message) -> str:
    try:
        raw = part.get_payload(decode=True)
        if raw is None:
            return ""
        charset = part.get_content_charset() or "utf-8"
        return raw.decode(charset, errors="replace")
    except Exception:  # noqa: BLE001
        return ""


def build_from_credentials(
    account_id: str, display_name: str, creds: dict[str, Any]
) -> ImapProvider:
    """Construct an ImapProvider from a stored credentials dict.

    Expected keys: username, password, imap_host, imap_port, imap_use_tls,
    smtp_host, smtp_port, smtp_use_tls. Missing host/port fields are filled by
    domain auto-detection from the username/email.
    """
    creds_data = creds.get("creds") if isinstance(creds.get("creds"), dict) else creds
    username = creds_data.get("username") or creds_data.get("account_email") or ""
    password = creds_data.get("password", "")
    if not username or not password:
        raise ValueError("IMAP credentials require username and password")

    auto = auto_detect_imap_config(username)
    return ImapProvider(
        account_id=account_id,
        display_name=display_name or username,
        username=username,
        password=password,
        imap_host=creds_data.get("imap_host") or auto["imap_host"],
        imap_port=int(creds_data.get("imap_port") or auto["imap_port"]),
        imap_use_tls=_as_bool(creds_data.get("imap_use_tls", auto["imap_use_tls"])),
        smtp_host=creds_data.get("smtp_host") or auto["smtp_host"],
        smtp_port=int(creds_data.get("smtp_port") or auto["smtp_port"]),
        smtp_use_tls=_as_bool(creds_data.get("smtp_use_tls", auto["smtp_use_tls"])),
    )


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in ("1", "true", "yes", "on")
    return bool(value)
