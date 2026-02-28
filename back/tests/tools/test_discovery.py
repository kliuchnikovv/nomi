# back/tests/tools/test_discovery.py
import json
import pytest
from unittest.mock import AsyncMock, MagicMock
from src.tools.discovery import build_discovery_tool
from src.tools.factory import ToolsConfig
from src.tools.router import RoutingDecision


def _make_config() -> ToolsConfig:
    config = ToolsConfig()
    config.add(
        "gmail",
        access_token="tok",
        refresh_token="ref",
        accounts=[{"id": "work@gmail.com", "display_name": "work@gmail.com"}],
    )
    return config


@pytest.fixture
def mock_config_client():
    client = MagicMock()
    client.fetch_tools = AsyncMock(return_value=_make_config())
    return client


@pytest.fixture
def mock_runner():
    return AsyncMock(return_value="client tool result")


@pytest.fixture
def gmail_schema():
    return [{
        "name": "gmail",
        "display_name": "Gmail",
        "description": "Email",
        "methods": [{"name": "send_email", "description": "Send", "parameters": {}}],
        "accounts": [{"id": "work@gmail.com", "display_name": "work@gmail.com"}],
        "execution": "hybrid",
    }]


@pytest.mark.asyncio
async def test_discovery_tool_returns_result_on_success(
    mock_config_client, mock_runner, gmail_schema, monkeypatch
):
    monkeypatch.setattr("src.tools.discovery.ToolRegistry.build", lambda c: gmail_schema)
    mock_router = MagicMock()
    mock_router.decide.return_value = RoutingDecision(
        action="execute", tool="gmail", method="send_email",
        account_id="work@gmail.com", params={"to": "pete@x.com", "subject": "Hi", "body": "Hello"},
    )
    mock_executor = MagicMock()
    mock_executor.run.return_value = "Email sent"

    fn = build_discovery_tool(
        user_id="user1",
        config_client=mock_config_client,
        client_tool_runner=mock_runner,
        router=mock_router,
        executor=mock_executor,
    )

    result_json = await fn.entrypoint(request="send email to pete", context="")
    result = json.loads(result_json)
    assert result["type"] == "result"
    assert result["result"] == "Email sent"


@pytest.mark.asyncio
async def test_discovery_tool_returns_question_for_ambiguous(
    mock_config_client, mock_runner, gmail_schema, monkeypatch
):
    monkeypatch.setattr("src.tools.discovery.ToolRegistry.build", lambda c: gmail_schema)
    mock_router = MagicMock()
    mock_router.decide.return_value = RoutingDecision(
        action="question",
        question="Which account?",
        options=["work@gmail.com", "personal@gmail.com"],
    )

    fn = build_discovery_tool(
        user_id="user1",
        config_client=mock_config_client,
        client_tool_runner=mock_runner,
        router=mock_router,
        executor=MagicMock(),
    )

    result_json = await fn.entrypoint(request="send email", context="")
    result = json.loads(result_json)
    assert result["type"] == "question"
    assert "Which account?" in result["question"]
    assert len(result["options"]) == 2


@pytest.mark.asyncio
async def test_discovery_tool_returns_error_for_no_tool(
    mock_config_client, mock_runner, gmail_schema, monkeypatch
):
    monkeypatch.setattr("src.tools.discovery.ToolRegistry.build", lambda c: gmail_schema)
    mock_router = MagicMock()
    mock_router.decide.return_value = RoutingDecision(action="none")

    fn = build_discovery_tool(
        user_id="user1",
        config_client=mock_config_client,
        client_tool_runner=mock_runner,
        router=mock_router,
        executor=MagicMock(),
    )

    result_json = await fn.entrypoint(request="play chess", context="")
    result = json.loads(result_json)
    assert result["type"] == "error"
    assert "play chess" in result["error"]


@pytest.mark.asyncio
async def test_discovery_tool_uses_client_runner_for_client_execution(
    mock_config_client, mock_runner, monkeypatch
):
    client_schema = [{
        "name": "ios_calendar",
        "display_name": "iOS Calendar",
        "description": "Calendar",
        "methods": [{"name": "create_event", "description": "Create", "parameters": {}}],
        "accounts": [],
        "execution": "client",
    }]
    monkeypatch.setattr("src.tools.discovery.ToolRegistry.build", lambda c: client_schema)
    mock_router = MagicMock()
    mock_router.decide.return_value = RoutingDecision(
        action="execute", tool="ios_calendar", method="create_event",
        account_id="", params={"title": "Meeting"},
    )

    fn = build_discovery_tool(
        user_id="user1",
        config_client=mock_config_client,
        client_tool_runner=mock_runner,
        router=mock_router,
        executor=MagicMock(),
    )

    result_json = await fn.entrypoint(request="create calendar event", context="")
    result = json.loads(result_json)
    assert result["type"] == "result"
    mock_runner.assert_called_once_with("ios_calendar", "create_event", {"title": "Meeting"})


@pytest.mark.asyncio
async def test_discovery_tool_returns_error_when_fetch_tools_fails(
    mock_runner, monkeypatch
):
    failing_client = MagicMock()
    failing_client.fetch_tools = AsyncMock(side_effect=Exception("DB error"))

    fn = build_discovery_tool(
        user_id="user1",
        config_client=failing_client,
        client_tool_runner=mock_runner,
        router=MagicMock(),
        executor=MagicMock(),
    )

    result_json = await fn.entrypoint(request="send email", context="")
    result = json.loads(result_json)
    assert result["type"] == "error"
    assert "Failed to load integrations" in result["error"]
