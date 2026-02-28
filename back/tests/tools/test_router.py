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
        {"name": "send_email", "description": "Send an email", "parameters": {
            "type": "object",
            "properties": {
                "to": {"type": "string"},
                "subject": {"type": "string"},
                "body": {"type": "string"},
            },
        }},
    ],
    "accounts": [{"id": "work@gmail.com", "display_name": "work@gmail.com"}],
    "execution": "hybrid",
}


@pytest.fixture
def router(monkeypatch):
    import google.generativeai as genai
    # Prevent real API calls during construction
    monkeypatch.setattr(genai, "configure", lambda **kwargs: None)
    monkeypatch.setattr(genai, "GenerativeModel", lambda **kwargs: MagicMock())
    return ToolRouter()


def _mock_gemini_response(decision: dict):
    mock_resp = MagicMock()
    mock_resp.text = json.dumps(decision)
    mock_model = MagicMock()
    mock_model.generate_content.return_value = mock_resp
    return mock_model


def test_router_returns_execute_for_clear_request(router, monkeypatch):
    decision = {
        "action": "execute",
        "tool": "gmail",
        "method": "send_email",
        "account_id": "work@gmail.com",
        "params": {"to": "pete@example.com", "subject": "Hi", "body": "Hello"},
    }
    monkeypatch.setattr(router, "_model", _mock_gemini_response(decision))
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
    monkeypatch.setattr(router, "_model", _mock_gemini_response(decision))
    result = router.decide("send email to pete", "", [schema])
    assert result.action == "question"
    assert len(result.options) == 2


def test_router_returns_none_for_unknown_request(router, monkeypatch):
    decision = {"action": "none"}
    monkeypatch.setattr(router, "_model", _mock_gemini_response(decision))
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
    mock_model = _mock_gemini_response(decision)
    original_generate = mock_model.generate_content
    def capturing_generate(prompt, **kwargs):
        captured["prompt"] = prompt
        return original_generate(prompt, **kwargs)
    mock_model.generate_content = capturing_generate
    monkeypatch.setattr(router, "_model", mock_model)

    router.decide("send email", "use work@gmail.com", [GMAIL_SCHEMA])
    assert "use work@gmail.com" in captured["prompt"]


def test_router_returns_none_on_model_failure(router, monkeypatch):
    mock_model = MagicMock()
    mock_model.generate_content.side_effect = Exception("API error")
    monkeypatch.setattr(router, "_model", mock_model)

    result = router.decide("send email", "", [GMAIL_SCHEMA])
    assert result.action == "none"
    assert result.tool == ""
