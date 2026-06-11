"""Tests for UnifiedEmailTools fan-out and handle-routed writes (mock providers)."""

import asyncio

import pytest

from src.email.filter import EmailFilter
from src.email.providers.base import (
    EmailAccount,
    EmailMessage,
    EmailProvider,
    encode_handle,
)
from src.email.unified import UnifiedEmailTools


class FakeProvider(EmailProvider):
    def __init__(self, account_id: str, display_name: str):
        self.account_id = account_id
        self.display_name = display_name
        self.provider_name = "fake"
        self.marked: list[tuple[str, str]] = []

    async def search(self, filt: EmailFilter) -> list[EmailMessage]:
        return [
            EmailMessage(
                account_id=self.account_id,
                provider=self.provider_name,
                id="1",
                subject=f"Hello from {self.display_name}",
                from_=f"sender@{self.display_name}",
            )
        ]

    async def get_message(self, msg_id, mailbox="INBOX"):
        return EmailMessage(
            account_id=self.account_id,
            provider=self.provider_name,
            id=msg_id,
            mailbox=mailbox,
            body="full body",
        )

    async def list_mailboxes(self):
        return ["INBOX", "Sent"]

    async def send(self, to, subject, body, cc=None, bcc=None, html=False):
        return f"sent:{self.account_id}"

    async def reply(self, msg_id, body, mailbox="INBOX", html=False):
        return f"reply:{self.account_id}"

    async def mark(self, msg_id, mailbox, status, remove=False):
        self.marked.append((msg_id, status))
        return f"marked:{self.account_id}:{msg_id}:{status}"


def _build_tools():
    p1 = FakeProvider("a1", "alice")
    p2 = FakeProvider("a2", "bob")
    accounts = [
        EmailAccount("a1", "alice", "fake", p1),
        EmailAccount("a2", "bob", "fake", p2),
    ]
    return UnifiedEmailTools(accounts), p1, p2


def test_search_fans_out_across_all_accounts():
    tools, _, _ = _build_tools()
    out = asyncio.run(tools.search_emails(query="hello"))
    assert "alice [fake]" in out
    assert "bob [fake]" in out
    assert "Hello from alice" in out
    assert "Hello from bob" in out
    assert "handle:" in out


def test_search_scoped_to_one_account():
    tools, _, _ = _build_tools()
    out = asyncio.run(tools.search_emails(query="hello", accounts="a1"))
    assert "alice" in out
    assert "bob" not in out


def test_handle_routes_write_to_correct_account():
    tools, p1, p2 = _build_tools()
    out = asyncio.run(tools.search_emails())
    # Pull bob's handle from his entry in the merged list.
    bob_block = out.split("Hello from bob")[1]
    handle = bob_block.split("handle:")[1].split("\n")[0].strip()

    result = asyncio.run(tools.mark_email(handle=handle, status="read"))
    assert "marked:a2" in result
    assert p2.marked == [("1", "read")]
    assert p1.marked == []


def test_results_sorted_newest_first_across_accounts():
    class DatedProvider(EmailProvider):
        def __init__(self, account_id, display_name, msgs):
            self.account_id = account_id
            self.display_name = display_name
            self.provider_name = "fake"
            self._msgs = msgs

        async def search(self, filt):
            return [
                EmailMessage(
                    account_id=self.account_id,
                    provider="fake",
                    id=mid,
                    subject=subj,
                    date=date,
                )
                for mid, subj, date in self._msgs
            ]

        async def get_message(self, msg_id, mailbox="INBOX"):
            raise NotImplementedError

        async def list_mailboxes(self):
            return []

        async def send(self, *a, **k):
            return ""

        async def reply(self, *a, **k):
            return ""

        async def mark(self, *a, **k):
            return ""

    # alice has an old + a very recent email; bob has a mid-dated one.
    p1 = DatedProvider(
        "a1",
        "alice",
        [
            ("1", "OLD", "Mon, 01 Jan 2024 10:00:00 +0000"),
            ("2", "NEWEST", "Fri, 10 May 2024 10:00:00 +0000"),
        ],
    )
    p2 = DatedProvider(
        "a2", "bob", [("3", "MIDDLE", "Wed, 01 Mar 2024 10:00:00 +0000")]
    )
    tools = UnifiedEmailTools(
        [
            EmailAccount("a1", "alice", "fake", p1),
            EmailAccount("a2", "bob", "fake", p2),
        ]
    )
    out = asyncio.run(tools.search_emails())
    # Subjects must appear newest -> oldest.
    assert out.index("NEWEST") < out.index("MIDDLE") < out.index("OLD")


def test_get_email_returns_body():
    tools, _, _ = _build_tools()
    out = asyncio.run(tools.search_emails(accounts="a1"))
    handle = out.split("handle:")[1].split("\n")[0].strip()
    body = asyncio.run(tools.get_email(handle=handle))
    assert "full body" in body


def test_list_accounts():
    tools, _, _ = _build_tools()
    out = tools.list_email_accounts()
    assert "a1" in out and "a2" in out


def test_stale_handle_single_account_falls_back():
    """A handle with an unknown account_id routes to the only account."""
    p1 = FakeProvider("a1", "alice")
    tools = UnifiedEmailTools([EmailAccount("a1", "alice", "fake", p1)])
    stale = encode_handle("DEAD-UUID", "fake", "INBOX", "1")
    body = asyncio.run(tools.get_email(handle=stale))
    assert "full body" in body


def test_stale_handle_provider_match_single():
    """A stale handle whose provider matches exactly one account routes there."""
    p_fake = FakeProvider("a1", "alice")

    class OtherProvider(FakeProvider):
        def __init__(self, account_id, display_name):
            super().__init__(account_id, display_name)
            self.provider_name = "other"

    p_other = OtherProvider("a2", "bob")
    tools = UnifiedEmailTools(
        [
            EmailAccount("a1", "alice", "fake", p_fake),
            EmailAccount("a2", "bob", "other", p_other),
        ]
    )
    stale = encode_handle("DEAD-UUID", "fake", "INBOX", "9")
    result = asyncio.run(tools.mark_email(handle=stale, status="read"))
    assert "marked:a1" in result
    assert p_fake.marked == [("9", "read")]
    assert p_other.marked == []


def test_stale_handle_ambiguous_raises_instructive():
    """A stale handle that matches multiple same-provider accounts is rejected."""
    tools, _, _ = _build_tools()  # two "fake" accounts
    stale = encode_handle("DEAD-UUID", "fake", "INBOX", "1")
    with pytest.raises(ValueError, match="search_emails"):
        asyncio.run(tools.get_email(handle=stale))
