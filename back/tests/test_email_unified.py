"""Tests for UnifiedEmailTools fan-out and handle-routed writes (mock providers)."""

import asyncio

from src.email.filter import EmailFilter
from src.email.providers.base import EmailAccount, EmailMessage, EmailProvider
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
    assert "[alice [fake]]" in out
    assert "[bob [fake]]" in out
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
    # Pull a handle out of bob's block.
    bob_block = out.split("[bob [fake]]")[1]
    handle = bob_block.split("handle:")[1].split("\n")[0].strip()

    result = asyncio.run(tools.mark_email(handle=handle, status="read"))
    assert "marked:a2" in result
    assert p2.marked == [("1", "read")]
    assert p1.marked == []


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
