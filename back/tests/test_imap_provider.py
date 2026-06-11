"""Tests for the IMAP provider's SEARCH encoding behaviour."""

from unittest.mock import MagicMock

from src.email.providers.imap import ImapProvider


def _provider() -> ImapProvider:
    return ImapProvider(
        account_id="acct-1",
        display_name="Test",
        username="user@example.com",
        password="secret",
        imap_host="imap.example.com",
    )


def _mock_conn() -> MagicMock:
    conn = MagicMock()
    # No results — we only care about how SEARCH is invoked.
    conn.uid.return_value = ("OK", [b""])
    return conn


def test_ascii_search_uses_plain_criteria(monkeypatch):
    provider = _provider()
    conn = _mock_conn()
    monkeypatch.setattr(provider, "_imap_connect", lambda: conn)

    provider._sync_search('TEXT "hello"', "INBOX", 10)

    conn.uid.assert_called_once_with("SEARCH", None, 'TEXT "hello"')


def test_non_ascii_search_uses_utf8_charset_and_bytes(monkeypatch):
    provider = _provider()
    conn = _mock_conn()
    monkeypatch.setattr(provider, "_imap_connect", lambda: conn)

    criteria = 'TEXT "Оповещение системы безопасности"'
    # Must not raise UnicodeEncodeError.
    provider._sync_search(criteria, "INBOX", 10)

    conn.uid.assert_called_once_with(
        "SEARCH", "CHARSET", "UTF-8", criteria.encode("utf-8")
    )
