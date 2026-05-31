"""Provider abstraction for the unified email subsystem.

``EmailProvider`` is the common interface implemented by ``GmailProvider`` and
``ImapProvider``. ``EmailMessage`` is the normalized message shape returned by
every provider, carrying a stable, opaque ``handle`` so the agent can act on a
specific result returned from a multi-account fan-out search.
"""

from __future__ import annotations

import base64
import json
import logging
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from typing import Any

from src.email.filter import EmailFilter

logger = logging.getLogger(__name__)


@dataclass
class EmailMessage:
    """Normalized email across providers."""

    account_id: str
    provider: str
    id: str  # provider-native id (Gmail message id, or IMAP uid as string)
    mailbox: str = "INBOX"
    subject: str = ""
    from_: str = ""
    to: list[str] = field(default_factory=list)
    date: str = ""
    snippet: str = ""
    flags: list[str] = field(default_factory=list)
    unread: bool = False
    body: str | None = None

    @property
    def handle(self) -> str:
        """Opaque, URL-safe handle encoding (account, provider, mailbox, id)."""
        return encode_handle(self.account_id, self.provider, self.mailbox, self.id)

    def to_dict(self, include_body: bool = True) -> dict[str, Any]:
        d = asdict(self)
        d["handle"] = self.handle
        if not include_body:
            d.pop("body", None)
        return d


def encode_handle(account_id: str, provider: str, mailbox: str, msg_id: str) -> str:
    """Encode a message reference into a single opaque token."""
    raw = json.dumps(
        {"a": account_id, "p": provider, "m": mailbox, "i": msg_id},
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_handle(handle: str) -> dict[str, str]:
    """Decode an opaque handle back into its parts.

    Raises ValueError if the handle is malformed.
    """
    pad = "=" * (-len(handle) % 4)
    try:
        raw = base64.urlsafe_b64decode(handle + pad)
        data = json.loads(raw)
    except Exception as exc:  # noqa: BLE001 - normalize to ValueError for callers
        raise ValueError(f"Invalid email handle: {handle!r}") from exc
    return {
        "account_id": data.get("a", ""),
        "provider": data.get("p", ""),
        "mailbox": data.get("m", "INBOX"),
        "id": data.get("i", ""),
    }


@dataclass
class EmailAccount:
    """An email account bound to a provider instance."""

    id: str
    display_name: str
    provider_name: str  # "gmail" | "imap"
    provider: "EmailProvider"


class EmailProvider(ABC):
    """Common interface for a single email account on the server."""

    account_id: str
    display_name: str
    provider_name: str

    # -- reads ---------------------------------------------------------------

    @abstractmethod
    async def search(self, filt: EmailFilter) -> list[EmailMessage]:
        """Return messages in ``filt.mailbox`` matching the filter."""

    async def list_recent(self, filt: EmailFilter) -> list[EmailMessage]:
        """Return the most recent messages in the mailbox (filter narrows)."""
        return await self.search(filt)

    @abstractmethod
    async def get_message(self, msg_id: str, mailbox: str = "INBOX") -> EmailMessage:
        """Fetch a single message including its body."""

    @abstractmethod
    async def list_mailboxes(self) -> list[str]:
        """List available mailboxes / folders."""

    # -- writes --------------------------------------------------------------

    @abstractmethod
    async def send(
        self,
        to: str,
        subject: str,
        body: str,
        cc: str | None = None,
        bcc: str | None = None,
        html: bool = False,
    ) -> str:
        """Send a new email; return a human-readable status string."""

    @abstractmethod
    async def reply(
        self, msg_id: str, body: str, mailbox: str = "INBOX", html: bool = False
    ) -> str:
        """Reply to an existing message; return a status string."""

    @abstractmethod
    async def mark(
        self, msg_id: str, mailbox: str, status: str, remove: bool = False
    ) -> str:
        """Set/clear a status flag (read/flagged) on a message."""

    # Optional capabilities — providers override where supported.

    async def create_draft(
        self,
        to: str,
        subject: str,
        body: str,
        cc: str | None = None,
        bcc: str | None = None,
        html: bool = False,
    ) -> str:
        raise NotImplementedError(
            f"{self.provider_name} does not support draft creation"
        )

    async def move(self, msg_id: str, mailbox: str, destination: str) -> str:
        raise NotImplementedError(f"{self.provider_name} does not support move")

    async def archive(self, msg_id: str, mailbox: str = "INBOX") -> str:
        raise NotImplementedError(f"{self.provider_name} does not support archive")

    async def delete(self, msg_id: str, mailbox: str = "INBOX") -> str:
        raise NotImplementedError(f"{self.provider_name} does not support delete")
