# back/tests/tools/test_executor.py
import pytest
from unittest.mock import MagicMock
from src.tools.executor import ServerToolExecutor


@pytest.fixture
def executor():
    return ServerToolExecutor()


def test_executor_raises_for_unknown_tool(executor):
    with pytest.raises(ValueError, match="No executor registered for: unknown_tool"):
        executor.run("unknown_tool", "some_method", {}, {})


def test_executor_calls_web_search(executor, monkeypatch):
    mock_toolkit = MagicMock()
    mock_toolkit.duckduckgo_search.return_value = "search results"
    monkeypatch.setattr("src.tools.executor._build_web_search", lambda creds: mock_toolkit)

    result = executor.run("web_search", "duckduckgo_search", {"query": "python"}, {})
    assert result == "search results"
    mock_toolkit.duckduckgo_search.assert_called_once_with(query="python")


def test_executor_calls_gmail(executor, monkeypatch):
    mock_toolkit = MagicMock()
    mock_toolkit.send_email.return_value = "Email sent"
    monkeypatch.setattr("src.tools.executor._build_gmail", lambda creds: mock_toolkit)

    result = executor.run(
        "gmail", "send_email",
        {"to": "pete@example.com", "subject": "Hi", "body": "Hello"},
        {"access_token": "tok", "refresh_token": "ref"},
    )
    assert result == "Email sent"
    mock_toolkit.send_email.assert_called_once_with(
        to="pete@example.com", subject="Hi", body="Hello"
    )


def test_executor_raises_for_unknown_method(executor, monkeypatch):
    mock_toolkit = MagicMock(spec=[])  # No attributes
    monkeypatch.setattr("src.tools.executor._build_gmail", lambda creds: mock_toolkit)

    with pytest.raises(ValueError, match="Tool gmail has no method: nonexistent"):
        executor.run("gmail", "nonexistent", {}, {"access_token": "tok"})


def test_executor_returns_empty_string_for_none_result(executor, monkeypatch):
    mock_toolkit = MagicMock()
    mock_toolkit.some_method.return_value = None
    monkeypatch.setattr("src.tools.executor._build_web_search", lambda creds: mock_toolkit)

    result = executor.run("web_search", "some_method", {}, {})
    assert result == ""


def test_executor_calls_github(executor, monkeypatch):
    mock_toolkit = MagicMock()
    mock_toolkit.list_repos.return_value = "repo1, repo2"
    monkeypatch.setattr("src.tools.executor._build_github", lambda creds: mock_toolkit)

    result = executor.run("github", "list_repos", {"limit": 10}, {"access_token": "gh_tok"})
    assert result == "repo1, repo2"
    mock_toolkit.list_repos.assert_called_once_with(limit=10)
