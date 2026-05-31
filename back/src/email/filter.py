"""Structured email filter and provider-specific query translators.

A single ``EmailFilter`` describes *what* to look at (accounts, mailbox,
status, sender/subject/date, free text). Each provider translates it into its
native query language:

* Gmail  -> a Gmail search-box query string (``from:`` ``subject:`` ``is:unread`` ...)
* IMAP   -> an IMAP ``SEARCH`` criteria string (``FROM`` ``SUBJECT`` ``UNSEEN`` ...)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

# Status values the filter understands. ``important`` has no IMAP equivalent,
# so it falls back to ``FLAGGED`` for IMAP.
STATUS_UNREAD = "unread"
STATUS_FLAGGED = "flagged"
STATUS_IMPORTANT = "important"

_MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]


def _parse_iso_date(value: str) -> datetime | None:
    """Parse a ``YYYY-MM-DD`` (or full ISO) date; return None if unparseable."""
    if not value:
        return None
    text = value.strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(text[:10], fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _to_gmail_date(value: str) -> str | None:
    """``YYYY-MM-DD`` -> ``YYYY/MM/DD`` (Gmail ``after:``/``before:`` format)."""
    dt = _parse_iso_date(value)
    return dt.strftime("%Y/%m/%d") if dt else None


def _to_imap_date(value: str) -> str | None:
    """``YYYY-MM-DD`` -> ``DD-Mon-YYYY`` (IMAP ``SINCE``/``BEFORE`` format)."""
    dt = _parse_iso_date(value)
    if not dt:
        return None
    return f"{dt.day:02d}-{_MONTHS[dt.month - 1]}-{dt.year}"


def _imap_quote(value: str) -> str:
    """Quote a string for an IMAP SEARCH argument."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


@dataclass
class EmailFilter:
    """What to look at across one or more email accounts.

    ``accounts`` is a list of account ids, or ``None``/``["all"]`` to mean every
    account. The remaining fields narrow the search; unset fields are ignored.
    """

    accounts: list[str] | None = None
    mailbox: str = "INBOX"
    status: str | None = None
    sender: str | None = None
    subject: str | None = None
    since: str | None = None  # ISO date (YYYY-MM-DD)
    before: str | None = None  # ISO date (YYYY-MM-DD)
    query: str | None = None  # free-text match
    limit: int = 20

    _extra: dict[str, Any] = field(default_factory=dict, repr=False)

    @property
    def all_accounts(self) -> bool:
        """True when the filter targets every account."""
        if not self.accounts:
            return True
        return any((a or "").lower() == "all" for a in self.accounts)

    def matches_account(self, account_id: str) -> bool:
        """Whether a given account id is in scope for this filter."""
        return self.all_accounts or account_id in (self.accounts or [])

    # -- provider translators -------------------------------------------------

    def to_gmail_query(self) -> str:
        """Build a Gmail search-box query from this filter."""
        parts: list[str] = []

        mailbox = (self.mailbox or "").strip()
        if mailbox:
            parts.append(f"in:{mailbox.lower()}" if mailbox.upper() == "INBOX"
                         else f"in:{mailbox}")

        if self.sender:
            parts.append(f"from:{self.sender}")
        if self.subject:
            parts.append(f'subject:"{self.subject}"')

        if self.status == STATUS_UNREAD:
            parts.append("is:unread")
        elif self.status == STATUS_FLAGGED:
            parts.append("is:starred")
        elif self.status == STATUS_IMPORTANT:
            parts.append("is:important")

        if self.since:
            gd = _to_gmail_date(self.since)
            if gd:
                parts.append(f"after:{gd}")
        if self.before:
            gd = _to_gmail_date(self.before)
            if gd:
                parts.append(f"before:{gd}")

        if self.query:
            parts.append(self.query.strip())

        return " ".join(p for p in parts if p).strip()

    def to_imap_criteria(self) -> str:
        """Build an IMAP SEARCH criteria string from this filter.

        Note: ``mailbox`` is *not* part of the criteria — it is the folder the
        provider SELECTs before searching.
        """
        parts: list[str] = []

        if self.status == STATUS_UNREAD:
            parts.append("UNSEEN")
        elif self.status in (STATUS_FLAGGED, STATUS_IMPORTANT):
            parts.append("FLAGGED")

        if self.sender:
            parts.append(f"FROM {_imap_quote(self.sender)}")
        if self.subject:
            parts.append(f"SUBJECT {_imap_quote(self.subject)}")

        if self.since:
            d = _to_imap_date(self.since)
            if d:
                parts.append(f"SINCE {d}")
        if self.before:
            d = _to_imap_date(self.before)
            if d:
                parts.append(f"BEFORE {d}")

        if self.query:
            parts.append(f"TEXT {_imap_quote(self.query)}")

        return " ".join(parts) if parts else "ALL"


# IMAP/SMTP host+port defaults by email domain, used only as a fallback when
# stored credentials don't already carry host info. Ported from the device
# client (IMAPEmailClient.autoDetectConfig / IOSMailManager).
_PROVIDER_PROFILES: dict[str, dict[str, Any]] = {
    "gmail.com": {"imap_host": "imap.gmail.com", "smtp_host": "smtp.gmail.com",
                  "smtp_port": 465, "smtp_use_tls": True},
    "googlemail.com": {"imap_host": "imap.gmail.com", "smtp_host": "smtp.gmail.com",
                       "smtp_port": 465, "smtp_use_tls": True},
    "icloud.com": {"imap_host": "imap.mail.me.com", "smtp_host": "smtp.mail.me.com",
                   "smtp_port": 587, "smtp_use_tls": False},
    "me.com": {"imap_host": "imap.mail.me.com", "smtp_host": "smtp.mail.me.com",
               "smtp_port": 587, "smtp_use_tls": False},
    "mac.com": {"imap_host": "imap.mail.me.com", "smtp_host": "smtp.mail.me.com",
                "smtp_port": 587, "smtp_use_tls": False},
    "outlook.com": {"imap_host": "outlook.office365.com",
                    "smtp_host": "smtp-mail.outlook.com",
                    "smtp_port": 587, "smtp_use_tls": False},
    "hotmail.com": {"imap_host": "outlook.office365.com",
                    "smtp_host": "smtp-mail.outlook.com",
                    "smtp_port": 587, "smtp_use_tls": False},
    "live.com": {"imap_host": "outlook.office365.com",
                 "smtp_host": "smtp-mail.outlook.com",
                 "smtp_port": 587, "smtp_use_tls": False},
    "yahoo.com": {"imap_host": "imap.mail.yahoo.com", "smtp_host": "smtp.mail.yahoo.com",
                  "smtp_port": 465, "smtp_use_tls": True},
}


def auto_detect_imap_config(email: str) -> dict[str, Any]:
    """Best-effort IMAP/SMTP host+port config from an email address.

    Returns a dict with imap_host/imap_port/imap_use_tls/smtp_host/smtp_port/
    smtp_use_tls. Falls back to ``imap.<domain>`` / ``smtp.<domain>``.
    """
    domain = email.split("@")[-1].strip().lower() if "@" in email else ""
    base = {"imap_port": 993, "imap_use_tls": True,
            "smtp_port": 465, "smtp_use_tls": True}
    profile = _PROVIDER_PROFILES.get(domain)
    if profile:
        base.update(profile)
        base.setdefault("imap_port", 993)
        base.setdefault("imap_use_tls", True)
        return base
    if domain:
        base["imap_host"] = f"imap.{domain}"
        base["smtp_host"] = f"smtp.{domain}"
    return base
