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
    return [
        {
            "name": "gmail",
            "display_name": "Gmail",
            "description": "Email",
            "methods": [
                {"name": "send_email", "description": "Send", "parameters": {}}
            ],
            "accounts": [{"id": "work@gmail.com", "display_name": "work@gmail.com"}],
            "execution": "hybrid",
        }
    ]


@pytest.mark.asyncio
async def test_discovery_tool_returns_result_on_success(
    mock_config_client, mock_runner, gmail_schema, monkeypatch
):
    monkeypatch.setattr(
        "src.tools.discovery.ToolRegistry.build", lambda c: gmail_schema
    )
    mock_router = MagicMock()
    mock_router.decide.return_value = RoutingDecision(
        action="execute",
        tool="gmail",
        method="send_email",
        account_id="work@gmail.com",
        params={"to": "pete@x.com", "subject": "Hi", "body": "Hello"},
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
    # hybrid execution with client runner present: client runner takes precedence
    assert result["result"] == "client tool result"
    # resolved tool/method/account surfaced for the frontend
    assert result["tool"] == "gmail"
    assert result["method"] == "send_email"
    assert result["account"] == "work@gmail.com"
    mock_runner.assert_called_once_with(
        "gmail", "send_email", {"to": "pete@x.com", "subject": "Hi", "body": "Hello"}
    )


@pytest.mark.asyncio
async def test_discovery_tool_returns_question_for_ambiguous(
    mock_config_client, mock_runner, gmail_schema, monkeypatch
):
    monkeypatch.setattr(
        "src.tools.discovery.ToolRegistry.build", lambda c: gmail_schema
    )
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
async def test_discovery_question_returns_to_chat_without_popping_ask_user(
    mock_config_client, monkeypatch
):
    """A clarifying question is returned to chat for the LLM to relay — discovery
    must NOT pop a native ask_user modal (the nested round-trip's answer was never
    delivered back, hanging the chat). The LLM re-calls discovery with the answer
    in `context`."""
    schema = [
        {
            "name": "imap",
            "display_name": "Email (IMAP)",
            "description": "IMAP",
            "methods": [
                {
                    "name": "search_emails_server",
                    "description": "Search",
                    "parameters": {
                        "type": "object",
                        "properties": {"integration_id": {"type": "string"}},
                    },
                }
            ],
            "accounts": [
                {"id": "uuid-a", "display_name": "a@x.com"},
                {"id": "uuid-b", "display_name": "b@x.com"},
            ],
            "execution": "client",
        }
    ]
    monkeypatch.setattr("src.tools.discovery.ToolRegistry.build", lambda c: schema)
    mock_router = MagicMock()
    mock_router.decide.return_value = RoutingDecision(
        action="question",
        tool="imap",
        method="search_emails_server",
        question="Which account?",
        options=["a@x.com", "b@x.com"],
    )
    runner = AsyncMock()

    fn = build_discovery_tool(
        user_id="user1",
        config_client=mock_config_client,
        client_tool_runner=runner,
        router=mock_router,
        executor=MagicMock(),
    )

    result = json.loads(await fn.entrypoint(request="search emails", context=""))
    assert result["type"] == "question"
    assert result["question"] == "Which account?"
    assert result["options"] == ["a@x.com", "b@x.com"]
    # crucially: no native modal was popped
    runner.assert_not_called()


@pytest.mark.asyncio
async def test_discovery_question_falls_back_to_chat_without_runner(
    mock_config_client, gmail_schema, monkeypatch
):
    """No client runner (e.g. Telegram) → question is returned into chat as before."""
    monkeypatch.setattr(
        "src.tools.discovery.ToolRegistry.build", lambda c: gmail_schema
    )
    mock_router = MagicMock()
    mock_router.decide.return_value = RoutingDecision(
        action="question",
        tool="gmail",
        method="send_email",
        question="Which account?",
        options=["a", "b"],
    )

    fn = build_discovery_tool(
        user_id="user1",
        config_client=mock_config_client,
        client_tool_runner=None,
        router=mock_router,
        executor=MagicMock(),
    )

    result = json.loads(await fn.entrypoint(request="send email", context=""))
    assert result["type"] == "question"
    assert result["question"] == "Which account?"


@pytest.mark.asyncio
async def test_discovery_tool_returns_error_for_no_tool(
    mock_config_client, mock_runner, gmail_schema, monkeypatch
):
    monkeypatch.setattr(
        "src.tools.discovery.ToolRegistry.build", lambda c: gmail_schema
    )
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
    # no tool resolved → no tool field (frontend falls back to "discovery_tool")
    assert "tool" not in result


@pytest.mark.asyncio
async def test_discovery_tool_error_includes_resolved_tool(
    mock_config_client, gmail_schema, monkeypatch
):
    """When a resolved tool fails to execute, the error envelope carries tool/method
    so the frontend can label the card with the real tool instead of discovery_tool."""
    monkeypatch.setattr(
        "src.tools.discovery.ToolRegistry.build", lambda c: gmail_schema
    )
    # Mark gmail as server-execution so it hits the executor path.
    gmail_schema[0]["execution"] = "server"
    # credentials map keyed by account_id so server-exec finds a usable access_token
    cfg = ToolsConfig()
    cfg.add(
        "gmail",
        accounts=gmail_schema[0]["accounts"],
        credentials={"work@gmail.com": {"access_token": "tok"}},
    )
    mock_config_client.fetch_tools = AsyncMock(return_value=cfg)

    mock_router = MagicMock()
    mock_router.decide.return_value = RoutingDecision(
        action="execute",
        tool="gmail",
        method="search_emails",
        account_id="work@gmail.com",
        params={"query": "test"},
    )
    mock_executor = MagicMock()
    mock_executor.arun = AsyncMock(side_effect=Exception("boom"))

    fn = build_discovery_tool(
        user_id="user1",
        config_client=mock_config_client,
        client_tool_runner=None,
        router=mock_router,
        executor=mock_executor,
    )

    result = json.loads(await fn.entrypoint(request="find emails", context=""))
    assert result["type"] == "error"
    assert result["tool"] == "gmail"
    assert result["method"] == "search_emails"


@pytest.mark.asyncio
async def test_discovery_tool_uses_client_runner_for_client_execution(
    mock_config_client, mock_runner, monkeypatch
):
    client_schema = [
        {
            "name": "ios_calendar",
            "display_name": "iOS Calendar",
            "description": "Calendar",
            "methods": [
                {"name": "create_event", "description": "Create", "parameters": {}}
            ],
            "accounts": [],
            "execution": "client",
        }
    ]
    monkeypatch.setattr(
        "src.tools.discovery.ToolRegistry.build", lambda c: client_schema
    )
    mock_router = MagicMock()
    mock_router.decide.return_value = RoutingDecision(
        action="execute",
        tool="ios_calendar",
        method="create_event",
        account_id="",
        params={"title": "Meeting"},
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
    assert result["tool"] == "ios_calendar"
    assert result["method"] == "create_event"
    assert result["account"] == ""  # no account_id resolved
    mock_runner.assert_called_once_with(
        "ios_calendar", "create_event", {"title": "Meeting"}
    )


@pytest.mark.asyncio
async def test_discovery_injects_integration_id_for_client_method(
    mock_config_client, mock_runner, monkeypatch
):
    """Client methods that declare `integration_id` get the resolved account_id
    injected (the router can't know the device integration UUID)."""
    imap_schema = [
        {
            "name": "imap",
            "display_name": "Email (IMAP)",
            "description": "IMAP",
            "methods": [
                {
                    "name": "search_emails_server",
                    "description": "Search",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "integration_id": {"type": "string"},
                            "criteria": {"type": "string"},
                        },
                    },
                }
            ],
            "accounts": [{"id": "uuid-icloud", "display_name": "me@icloud.com"}],
            "execution": "client",
        }
    ]
    monkeypatch.setattr(
        "src.tools.discovery.ToolRegistry.build", lambda c: imap_schema
    )
    mock_router = MagicMock()
    mock_router.decide.return_value = RoutingDecision(
        action="execute",
        tool="imap",
        method="search_emails_server",
        account_id="uuid-icloud",
        params={"criteria": "from:google"},  # router omits integration_id
    )

    fn = build_discovery_tool(
        user_id="user1",
        config_client=mock_config_client,
        client_tool_runner=mock_runner,
        router=mock_router,
        executor=MagicMock(),
    )

    result = json.loads(await fn.entrypoint(request="search emails", context=""))
    assert result["type"] == "result"
    # integration_id is the display_name (email) so the device can resolve by
    # email when its local UUID differs from the server-side account_id.
    mock_runner.assert_called_once_with(
        "imap",
        "search_emails_server",
        {"criteria": "from:google", "integration_id": "me@icloud.com"},
    )


@pytest.mark.asyncio
async def test_discovery_overrides_question_for_all_accounts(
    mock_config_client, mock_runner, monkeypatch
):
    """When the user says 'all accounts' but the router asks which one, fan out (*)."""
    schema = [
        {
            "name": "imap",
            "display_name": "Email (IMAP)",
            "description": "IMAP",
            "methods": [
                {
                    "name": "search_emails_server",
                    "description": "Search",
                    "parameters": {
                        "type": "object",
                        "properties": {"integration_id": {"type": "string"}},
                    },
                }
            ],
            "accounts": [
                {"id": "uuid-a", "display_name": "a@x.com"},
                {"id": "uuid-b", "display_name": "b@x.com"},
            ],
            "execution": "client",
        }
    ]
    monkeypatch.setattr("src.tools.discovery.ToolRegistry.build", lambda c: schema)
    mock_router = MagicMock()
    # router (wrongly) asks which account, but still names tool/method
    mock_router.decide.return_value = RoutingDecision(
        action="question",
        tool="imap",
        method="search_emails_server",
        question="Which account?",
        options=["a@x.com", "b@x.com"],
    )

    fn = build_discovery_tool(
        user_id="user1",
        config_client=mock_config_client,
        client_tool_runner=mock_runner,
        router=mock_router,
        executor=MagicMock(),
    )

    result = json.loads(
        await fn.entrypoint(
            request="search emails from google across all accounts", context=""
        )
    )
    # overridden to fan-out, each account gets display_name (email) as integration_id
    assert result["type"] == "result"
    assert result["aggregated"] is True
    assert result["account_count"] == 2
    assert mock_runner.call_count == 2
    sent_ids = {c.args[2].get("integration_id") for c in mock_runner.call_args_list}
    assert sent_ids == {"a@x.com", "b@x.com"}


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


@pytest.mark.asyncio
async def test_discovery_tool_executes_for_all_accounts_with_asterisk(
    mock_config_client, mock_runner, gmail_schema, monkeypatch
):
    multi_account_config = ToolsConfig()
    multi_account_config.add(
        "gmail",
        access_token="tok1",
        refresh_token="ref1",
        accounts=[
            {"id": "work@gmail.com", "display_name": "work@gmail.com"},
            {"id": "personal@gmail.com", "display_name": "personal@gmail.com"},
        ],
        credentials={
            "work@gmail.com": {"access_token": "tok1", "refresh_token": "ref1"},
            "personal@gmail.com": {"access_token": "tok2", "refresh_token": "ref2"},
        },
    )

    mock_config_client.fetch_tools = AsyncMock(return_value=multi_account_config)

    multi_account_schema = [
        {
            "name": "gmail",
            "display_name": "Gmail",
            "description": "Email",
            "methods": [
                {
                    "name": "get_recent_emails",
                    "description": "Get emails",
                    "parameters": {},
                }
            ],
            "accounts": [
                {"id": "work@gmail.com", "display_name": "work@gmail.com"},
                {"id": "personal@gmail.com", "display_name": "personal@gmail.com"},
            ],
            "execution": "server",
        }
    ]

    monkeypatch.setattr(
        "src.tools.discovery.ToolRegistry.build", lambda c: multi_account_schema
    )

    mock_router = MagicMock()
    mock_router.decide.return_value = RoutingDecision(
        action="execute",
        tool="gmail",
        method="get_recent_emails",
        account_id="*",
        params={"limit": 5},
    )

    mock_executor = MagicMock()
    mock_executor.arun = AsyncMock(side_effect=[
        "Recent emails from work account",
        "Recent emails from personal account",
    ])

    fn = build_discovery_tool(
        user_id="user1",
        config_client=mock_config_client,
        client_tool_runner=mock_runner,
        router=mock_router,
        executor=mock_executor,
    )

    result_json = await fn.entrypoint(
        request="show emails from all accounts", context=""
    )
    result = json.loads(result_json)

    assert result["type"] == "result"
    assert result["aggregated"] is True
    assert result["account_count"] == 2
    assert result["tool"] == "gmail"
    assert result["method"] == "get_recent_emails"

    results = result["result"]
    assert len(results) == 2

    work_result = next(
        (r for r in results if r["account_id"] == "work@gmail.com"), None
    )
    personal_result = next(
        (r for r in results if r["account_id"] == "personal@gmail.com"), None
    )

    assert work_result is not None
    assert work_result["account_display"] == "work@gmail.com"
    assert work_result["result"] == "Recent emails from work account"

    assert personal_result is not None
    assert personal_result["account_display"] == "personal@gmail.com"
    assert personal_result["result"] == "Recent emails from personal account"

    assert mock_executor.arun.call_count == 2
