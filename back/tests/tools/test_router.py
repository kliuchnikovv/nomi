# back/tests/tools/test_router.py
import json
import pytest
from unittest.mock import MagicMock
from src.tools.router import ToolRouter

GMAIL_SCHEMA = {
    "name": "gmail",
    "display_name": "Gmail",
    "description": "Send and read Gmail emails",
    "methods": [
        {
            "name": "send_email",
            "description": "Send an email",
            "parameters": {
                "type": "object",
                "properties": {
                    "to": {"type": "string"},
                    "subject": {"type": "string"},
                    "body": {"type": "string"},
                },
            },
        },
    ],
    "accounts": [{"id": "work@gmail.com", "display_name": "work@gmail.com"}],
    "execution": "hybrid",
}


@pytest.fixture
def router(monkeypatch):
    from google import genai

    # Create a mock client
    mock_client = MagicMock()

    # Patch genai.Client to return mock client
    monkeypatch.setattr(genai, "Client", lambda **kwargs: mock_client)

    router = ToolRouter()
    router._client = mock_client
    return router


def _mock_gemini_response(decision: dict):
    """Create a mock response for the new google-genai API."""
    mock_resp = MagicMock()
    mock_resp.text = json.dumps(decision)
    return mock_resp


def test_router_returns_execute_for_clear_request(router, monkeypatch):
    decision = {
        "action": "execute",
        "tool": "gmail",
        "method": "send_email",
        "account_id": "work@gmail.com",
        "params": {"to": "pete@example.com", "subject": "Hi", "body": "Hello"},
    }
    router._client.models.generate_content.return_value = _mock_gemini_response(
        decision
    )
    result = router.decide("send email to pete@example.com", "", [GMAIL_SCHEMA])
    assert result.action == "execute"
    assert result.tool == "gmail"
    assert result.method == "send_email"
    assert result.account_id == "work@gmail.com"


def test_router_returns_question_for_write_with_multiple_accounts(router, monkeypatch):
    schema = dict(GMAIL_SCHEMA)
    schema["accounts"] = [
        {"id": "work@gmail.com", "display_name": "work@gmail.com"},
        {"id": "personal@gmail.com", "display_name": "personal@gmail.com"},
    ]
    decision = {
        "action": "question",
        "question": "Which account to use?",
        "options": ["work@gmail.com", "personal@gmail.com"],
    }
    router._client.models.generate_content.return_value = _mock_gemini_response(
        decision
    )
    result = router.decide("send email to pete", "", [schema])
    assert result.action == "question"
    assert len(result.options) == 2


def test_router_returns_none_for_unknown_request(router, monkeypatch):
    decision = {"action": "none"}
    router._client.models.generate_content.return_value = _mock_gemini_response(
        decision
    )
    result = router.decide("play chess", "", [GMAIL_SCHEMA])
    assert result.action == "none"


def test_router_passes_context_to_model(router, monkeypatch):
    captured = {}
    decision = {
        "action": "execute",
        "tool": "gmail",
        "method": "send_email",
        "account_id": "work@gmail.com",
        "params": {},
    }

    def capturing_generate(*args, **kwargs):
        captured["contents"] = kwargs.get("contents")
        return _mock_gemini_response(decision)

    router._client.models.generate_content.side_effect = capturing_generate

    router.decide("send email", "use work@gmail.com", [GMAIL_SCHEMA])
    assert "use work@gmail.com" in captured["contents"]


def test_router_returns_none_on_model_failure(router, monkeypatch):
    router._client.models.generate_content.side_effect = Exception("API error")

    result = router.decide("send email", "", [GMAIL_SCHEMA])
    assert result.action == "none"
    assert result.tool == ""


def test_router_returns_none_on_list_response(router, monkeypatch):
    """Test that router extracts first element from list responses from model."""
    mock_resp = MagicMock()
    # Model incorrectly returns a list instead of dict
    mock_resp.text = json.dumps(
        [{"action": "execute", "tool": "gmail", "method": "send_email"}]
    )
    router._client.models.generate_content.return_value = mock_resp

    result = router.decide("send email", "", [GMAIL_SCHEMA])
    # Router should extract the first element from the list
    assert result.action == "execute"
    assert result.tool == "gmail"
    assert result.method == "send_email"


def test_router_returns_none_on_empty_list(router, monkeypatch):
    """Test that router handles empty list responses from model."""
    mock_resp = MagicMock()
    mock_resp.text = json.dumps([])
    router._client.models.generate_content.return_value = mock_resp

    result = router.decide("send email", "", [GMAIL_SCHEMA])
    assert result.action == "none"


def test_router_returns_none_on_list_with_invalid_elements(router, monkeypatch):
    """Test that router handles list responses with non-dict elements."""
    mock_resp = MagicMock()
    # List contains strings instead of dict
    mock_resp.text = json.dumps(["not a dict", "also not a dict"])
    router._client.models.generate_content.return_value = mock_resp

    result = router.decide("send email", "", [GMAIL_SCHEMA])
    assert result.action == "none"


def test_router_returns_asterisk_for_all_accounts_request(router, monkeypatch):
    """Test that router returns account_id='*' for requests asking for all accounts."""
    schema = dict(GMAIL_SCHEMA)
    schema["accounts"] = [
        {"id": "work@gmail.com", "display_name": "work@gmail.com"},
        {"id": "personal@gmail.com", "display_name": "personal@gmail.com"},
    ]
    schema["methods"] = [
        {
            "name": "get_recent_emails",
            "description": "Get recent emails",
            "parameters": {},
        },
    ]

    decision = {
        "action": "execute",
        "tool": "gmail",
        "method": "get_recent_emails",
        "account_id": "*",
        "params": {},
    }
    router._client.models.generate_content.return_value = _mock_gemini_response(
        decision
    )

    result = router.decide("show emails from each account", "", [schema])
    assert result.action == "execute"
    assert result.account_id == "*"
    assert result.tool == "gmail"
    assert result.method == "get_recent_emails"
