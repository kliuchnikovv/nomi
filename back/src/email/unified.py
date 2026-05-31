"""UnifiedEmailTools — one email tool surface over every account & provider.

Read operations (search / list) fan out across *all* in-scope accounts and
aggregate the results, each tagged with its account label and an opaque
``handle``. Write/single operations (get / send / reply / mark / move / ...)
are routed to exactly one account, identified either by an email ``handle``
returned from a previous search, or by an explicit ``account_id``.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from agno.tools import Toolkit

from src.email.filter import EmailFilter
from src.email.providers.base import (
    EmailAccount,
    EmailMessage,
    EmailProvider,
    decode_handle,
)

logger = logging.getLogger(__name__)


class UnifiedEmailTools(Toolkit):
    """Server-side, multi-account, multi-provider email toolkit."""

    def __init__(self, accounts: list[EmailAccount]):
        super().__init__(name="email")
        self._accounts: list[EmailAccount] = accounts
        self._by_id: dict[str, EmailAccount] = {a.id: a for a in accounts}

        self.register(self.list_email_accounts)
        self.register(self.search_emails)
        self.register(self.get_recent_emails)
        self.register(self.get_email)
        self.register(self.send_email)
        self.register(self.reply_email)
        self.register(self.create_draft)
        self.register(self.mark_email)
        self.register(self.move_email)
        self.register(self.archive_email)
        self.register(self.delete_email)
        self.register(self.list_mailboxes)

    # -- helpers -------------------------------------------------------------

    def _resolve_scope(self, accounts: str | None) -> list[EmailAccount]:
        """Resolve an ``accounts`` argument to the list of accounts to query."""
        if not accounts or accounts.strip().lower() == "all":
            return self._accounts
        wanted = {a.strip().lower() for a in accounts.split(",") if a.strip()}
        scoped = [
            a
            for a in self._accounts
            if a.id.lower() in wanted or a.display_name.lower() in wanted
        ]
        return scoped or self._accounts

    def _provider_for_handle(self, handle: str) -> tuple[EmailProvider, dict[str, str]]:
        ref = decode_handle(handle)
        acct = self._by_id.get(ref["account_id"])
        if not acct:
            raise ValueError(f"Unknown account in handle: {ref['account_id']}")
        return acct.provider, ref

    def _provider_for_account(self, account_id: str | None) -> EmailAccount:
        if account_id:
            acct = self._by_id.get(account_id)
            if acct:
                return acct
            # also accept display name
            for a in self._accounts:
                if a.display_name.lower() == account_id.lower():
                    return a
            raise ValueError(f"Unknown account: {account_id}")
        if len(self._accounts) == 1:
            return self._accounts[0]
        raise ValueError(
            "account_id is required for this operation when multiple accounts exist. "
            "Available: " + ", ".join(f"{a.id} ({a.display_name})" for a in self._accounts)
        )

    async def _fanout(self, filt: EmailFilter, accounts: str | None) -> str:
        scope = self._resolve_scope(accounts)
        if not scope:
            return "No email accounts are connected."

        async def run(acct: EmailAccount) -> tuple[EmailAccount, Any]:
            try:
                return acct, await acct.provider.search(filt)
            except Exception as e:  # noqa: BLE001
                logger.error("[email] search failed for %s: %s", acct.id, e, exc_info=True)
                return acct, e

        results = await asyncio.gather(*(run(a) for a in scope))

        # Merge every account's emails into a single list ordered newest-first
        # (by received time), so the freshest messages are always at the top
        # regardless of which account they came from.
        merged: list[tuple[EmailAccount, EmailMessage]] = []
        errors: list[str] = []
        for acct, res in results:
            label = f"{acct.display_name} [{acct.provider_name}]"
            if isinstance(res, Exception):
                errors.append(f"[{label}] Error: {res}")
            else:
                merged.extend((acct, msg) for msg in res)

        merged.sort(key=lambda am: am[1].received_ts, reverse=True)

        body = _format_messages(merged) if merged else "(no emails)"
        if errors:
            body += "\n\n" + "\n".join(errors)
        return body

    # -- read tools ----------------------------------------------------------

    def list_email_accounts(self) -> str:
        """List the user's connected email accounts (id, name, provider).

        Use this to discover account ids before targeting a specific account.
        """
        if not self._accounts:
            return "No email accounts are connected."
        return json.dumps(
            [
                {"id": a.id, "name": a.display_name, "provider": a.provider_name}
                for a in self._accounts
            ]
        )

    async def search_emails(
        self,
        query: str | None = None,
        sender: str | None = None,
        subject: str | None = None,
        status: str | None = None,
        since: str | None = None,
        before: str | None = None,
        mailbox: str = "INBOX",
        accounts: str | None = None,
        limit: int = 20,
    ) -> str:
        """Search emails across all connected accounts at once (default) or a subset.

        Args:
            query: Free-text to match anywhere in the email.
            sender: Filter by sender address/name (e.g. "alice@example.com").
            subject: Filter by subject text.
            status: One of "unread", "flagged", "important".
            since: Only emails on/after this date (YYYY-MM-DD).
            before: Only emails before this date (YYYY-MM-DD).
            mailbox: Folder to search (default "INBOX").
            accounts: Comma-separated account ids, or "all" (default) for every account.
            limit: Max emails per account.

        Returns results grouped by account; each email carries a `handle` you can
        pass to get_email / reply_email / mark_email / etc.
        """
        filt = EmailFilter(
            accounts=None,
            mailbox=mailbox,
            status=status,
            sender=sender,
            subject=subject,
            since=since,
            before=before,
            query=query,
            limit=limit,
        )
        return await self._fanout(filt, accounts)

    async def get_recent_emails(
        self,
        mailbox: str = "INBOX",
        status: str | None = None,
        accounts: str | None = None,
        limit: int = 20,
    ) -> str:
        """Get the most recent emails across all accounts (default) or a subset.

        Args:
            mailbox: Folder (default "INBOX").
            status: Optional "unread" / "flagged" / "important".
            accounts: Comma-separated account ids, or "all" (default).
            limit: Max emails per account.
        """
        filt = EmailFilter(mailbox=mailbox, status=status, limit=limit)
        return await self._fanout(filt, accounts)

    async def get_email(self, handle: str) -> str:
        """Fetch the full content (including body) of one email by its handle."""
        provider, ref = self._provider_for_handle(handle)
        msg = await provider.get_message(ref["id"], ref["mailbox"])
        return json.dumps(msg.to_dict(include_body=True), ensure_ascii=False)

    async def list_mailboxes(self, account_id: str | None = None) -> str:
        """List mailboxes/folders for an account (or the only account)."""
        acct = self._provider_for_account(account_id)
        boxes = await acct.provider.list_mailboxes()
        return json.dumps({"account": acct.display_name, "mailboxes": boxes})

    # -- write tools ---------------------------------------------------------

    async def send_email(
        self,
        to: str,
        subject: str,
        body: str,
        account_id: str | None = None,
        cc: str | None = None,
        bcc: str | None = None,
        html: bool = False,
    ) -> str:
        """Send an email. Specify account_id when more than one account exists."""
        acct = self._provider_for_account(account_id)
        return await acct.provider.send(to, subject, body, cc, bcc, html)

    async def reply_email(self, handle: str, body: str, html: bool = False) -> str:
        """Reply to an email identified by its handle (from a search result)."""
        provider, ref = self._provider_for_handle(handle)
        return await provider.reply(ref["id"], body, ref["mailbox"], html)

    async def create_draft(
        self,
        to: str,
        subject: str,
        body: str,
        account_id: str | None = None,
        cc: str | None = None,
        bcc: str | None = None,
        html: bool = False,
    ) -> str:
        """Create a draft email in the given account (Gmail accounts only)."""
        acct = self._provider_for_account(account_id)
        return await acct.provider.create_draft(to, subject, body, cc, bcc, html)

    async def mark_email(
        self, handle: str, status: str, remove: bool = False
    ) -> str:
        """Mark an email read/unread/flagged. status: "read"|"unread"|"flagged"."""
        provider, ref = self._provider_for_handle(handle)
        return await provider.mark(ref["id"], ref["mailbox"], status, remove)

    async def move_email(self, handle: str, destination: str) -> str:
        """Move an email to another mailbox/folder."""
        provider, ref = self._provider_for_handle(handle)
        return await provider.move(ref["id"], ref["mailbox"], destination)

    async def archive_email(self, handle: str) -> str:
        """Archive an email."""
        provider, ref = self._provider_for_handle(handle)
        return await provider.archive(ref["id"], ref["mailbox"])

    async def delete_email(self, handle: str) -> str:
        """Delete (trash) an email."""
        provider, ref = self._provider_for_handle(handle)
        return await provider.delete(ref["id"], ref["mailbox"])


def _format_messages(items: list[tuple[EmailAccount, EmailMessage]]) -> str:
    """Render a merged, newest-first list; each entry shows its account."""
    if not items:
        return "(no emails)"
    lines: list[str] = []
    for i, (acct, m) in enumerate(items, 1):
        unread = "● " if m.unread else "  "
        lines.append(
            f"{i}. {unread}{m.subject or '(no subject)'}\n"
            f"   account: {acct.display_name} [{acct.provider_name}]\n"
            f"   from: {m.from_}\n"
            f"   date: {m.date}\n"
            f"   handle: {m.handle}"
        )
    return "\n".join(lines)


def build_unified_email_tools(
    account_specs: list[dict[str, Any]],
) -> UnifiedEmailTools | None:
    """Build a UnifiedEmailTools from collected email account specs.

    Each spec: {"provider_name": "gmail"|"imap", "account_id": str,
                "display_name": str, "creds": dict}.
    Returns None if no accounts could be built.
    """
    from src.email.providers import gmail as gmail_mod
    from src.email.providers import imap as imap_mod

    builders = {
        "gmail": gmail_mod.build_from_credentials,
        "imap": imap_mod.build_from_credentials,
    }

    accounts: list[EmailAccount] = []
    for spec in account_specs:
        provider_name = (spec.get("provider_name") or "").lower()
        builder = builders.get(provider_name)
        if not builder:
            logger.warning("[email] no provider builder for %s", provider_name)
            continue
        account_id = spec.get("account_id") or ""
        display_name = spec.get("display_name") or account_id[:8]
        creds = spec.get("creds") or {}
        try:
            provider = builder(account_id, display_name, creds)
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "[email] failed to build %s account %s: %s",
                provider_name,
                account_id,
                e,
            )
            continue
        accounts.append(
            EmailAccount(
                id=account_id,
                display_name=display_name,
                provider_name=provider_name,
                provider=provider,
            )
        )

    if not accounts:
        return None
    logger.info("[email] built UnifiedEmailTools with %d account(s)", len(accounts))
    return UnifiedEmailTools(accounts)
