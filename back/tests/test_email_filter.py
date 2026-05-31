"""Unit tests for EmailFilter translators, handle codec, and auto-config."""

from src.email.filter import EmailFilter, auto_detect_imap_config
from src.email.providers.base import decode_handle, encode_handle


def test_gmail_query_full():
    f = EmailFilter(
        status="unread",
        sender="alice@example.com",
        subject="invoice",
        since="2024-01-15",
        before="2024-02-01",
        mailbox="INBOX",
    )
    q = f.to_gmail_query()
    assert "in:inbox" in q
    assert "from:alice@example.com" in q
    assert 'subject:"invoice"' in q
    assert "is:unread" in q
    assert "after:2024/01/15" in q
    assert "before:2024/02/01" in q


def test_gmail_query_non_inbox_mailbox():
    assert "in:Work" in EmailFilter(mailbox="Work").to_gmail_query()


def test_imap_criteria_full():
    f = EmailFilter(
        status="unread",
        sender="alice@example.com",
        subject="invoice",
        since="2024-01-15",
    )
    c = f.to_imap_criteria()
    assert "UNSEEN" in c
    assert 'FROM "alice@example.com"' in c
    assert 'SUBJECT "invoice"' in c
    assert "SINCE 15-Jan-2024" in c


def test_imap_criteria_empty_is_all():
    assert EmailFilter().to_imap_criteria() == "ALL"


def test_imap_flagged_and_important_map_to_flagged():
    assert "FLAGGED" in EmailFilter(status="flagged").to_imap_criteria()
    assert "FLAGGED" in EmailFilter(status="important").to_imap_criteria()


def test_all_accounts_semantics():
    assert EmailFilter().all_accounts is True
    assert EmailFilter(accounts=["all"]).all_accounts is True
    assert EmailFilter(accounts=["a1"]).all_accounts is False
    assert EmailFilter(accounts=["a1"]).matches_account("a1") is True
    assert EmailFilter(accounts=["a1"]).matches_account("a2") is False


def test_handle_round_trip():
    h = encode_handle("acct-1", "imap", "[Gmail]/All Mail", "12345")
    ref = decode_handle(h)
    assert ref == {
        "account_id": "acct-1",
        "provider": "imap",
        "mailbox": "[Gmail]/All Mail",
        "id": "12345",
    }


def test_auto_detect_known_and_fallback():
    gmail = auto_detect_imap_config("a@gmail.com")
    assert gmail["imap_host"] == "imap.gmail.com"
    assert gmail["imap_port"] == 993
    other = auto_detect_imap_config("a@example.org")
    assert other["imap_host"] == "imap.example.org"
    assert other["smtp_host"] == "smtp.example.org"
