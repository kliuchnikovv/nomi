# Discovery Tool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all agent tools with a single `discovery_tool` that uses `gemini-2.0-flash-lite` to route natural-language requests to the correct integration, handle multi-account disambiguation, and execute calls server-side (falling back to `client_action` for iOS-native integrations).

**Architecture:** `discovery_tool` is an Agno `Function` given as the sole tool to the main agent. Internally it fetches the user's `ToolsConfig` (which already contains credentials via Go API's `/api/tools`), builds tool schemas from plugin manifests, asks `gemini-2.0-flash-lite` to pick tool + method + account, then executes server-side or delegates to `client_tool_runner` for iOS-native tools. Write operations with multiple accounts always return a `question` response; the main model passes it to the user and calls `discovery_tool` again with `context`.

**Tech Stack:** Python 3.12, Agno (`agno.tools.Function`), `google-generativeai` (Gemini), `httpx`, `pytest`, existing `ToolConfigClient` + `tool_gen.py` patterns.

---

## How tokens reach Python (no changes needed)

Go API's `GET /api/tools?user_id=X` already returns every enabled integration with its credentials (`access_token`, `refresh_token`, etc.) in the `params` field. `ToolConfigClient.fetch_tools(user_id)` returns a `ToolsConfig` where each entry's `params` dict contains these credentials. The `discovery_tool` reads credentials from that config — no new DB access or token refresh logic required.

---

## Task 1: ToolRegistry — build routing schemas from ToolsConfig

Builds a compact list of tool schemas (name, description, methods, accounts) that the router will see. Does NOT include credentials.

**Files:**
- Create: `back/src/tools/registry.py`
- Test: `back/tests/tools/test_registry.py`

**Step 1: Write failing test**

```python
# back/tests/tools/test_registry.py
import pytest
from src.tools.registry import ToolRegistry
from src.tools.factory import ToolsConfig


def _make_config(*providers: str) -> ToolsConfig:
    config = ToolsConfig()
    for p in providers:
        config.add(p, access_token="tok", accounts=[{"id": "a@b.com", "display_name": "a@b.com"}])
    return config


def test_registry_returns_schemas_for_connected_integrations(monkeypatch):
    monkeypatch.setattr(
        "src.tools.registry._load_manifest",
        lambda name: {
            "name": name,
            "display_name": name.title(),
            "description": f"{name} integration",
            "methods": [
                {"name": "send", "description": "Send something", "parameters": {"type": "object", "properties": {}}}
            ],
        } if name == "gmail" else None,
    )
    config = _make_config("gmail")
    schemas = ToolRegistry.build(config)
    assert len(schemas) == 1
    assert schemas[0]["name"] == "gmail"
    assert schemas[0]["accounts"] == [{"id": "a@b.com", "display_name": "a@b.com"}]
    assert len(schemas[0]["methods"]) == 1


def test_registry_skips_unknown_integrations(monkeypatch):
    monkeypatch.setattr("src.tools.registry._load_manifest", lambda name: None)
    config = _make_config("unknown_tool")
    schemas = ToolRegistry.build(config)
    assert schemas == []


def test_registry_includes_web_search_without_accounts(monkeypatch):
    monkeypatch.setattr(
        "src.tools.registry._load_manifest",
        lambda name: {
            "name": "web_search",
            "display_name": "Web Search",
            "description": "Search the web",
            "methods": [{"name": "search", "description": "Search", "parameters": {}}],
        } if name == "web_search" else None,
    )
    config = _make_config("web_search")
    # web_search has no accounts field in params
    config.entries["web_search"].params.pop("accounts", None)
    schemas = ToolRegistry.build(config)
    assert len(schemas) == 1
    assert schemas[0]["accounts"] == []
```

**Step 2: Run test to verify it fails**

```bash
cd back && python -m pytest tests/tools/test_registry.py -v
```
Expected: `ModuleNotFoundError: No module named 'src.tools.registry'`

**Step 3: Implement**

```python
# back/src/tools/registry.py
from __future__ import annotations

import logging
from typing import Any

from src.tools.factory import ToolsConfig

logger = logging.getLogger(__name__)


def _load_manifest(provider_name: str) -> dict | None:
    try:
        from src.plugins.loader import get_manifest
        return get_manifest(provider_name)
    except Exception:
        return None


class ToolRegistry:
    @staticmethod
    def build(config: ToolsConfig) -> list[dict[str, Any]]:
        """
        Build routing schemas (no credentials) for all tools in config.

        Each schema:
        {
          "name": "gmail",
          "display_name": "Gmail",
          "description": "...",
          "methods": [{"name": "send_email", "description": "...", "parameters": {...}}],
          "accounts": [{"id": "work@gmail.com", "display_name": "work@gmail.com"}],
          "execution": "server" | "client",
        }
        """
        schemas: list[dict[str, Any]] = []
        seen: set[str] = set()

        for entry in config:
            manifest = _load_manifest(entry.name.lower())
            if not manifest:
                # Try provider field
                if entry.provider:
                    manifest = _load_manifest(entry.provider.lower())
            if not manifest:
                logger.debug("[Registry] No manifest for %s — skipping", entry.name)
                continue

            provider_name = manifest.get("name", entry.name)
            if provider_name in seen:
                continue
            seen.add(provider_name)

            exec_type = (manifest.get("execution") or {}).get("type", "server")
            accounts: list[dict] = entry.params.get("accounts") or []

            schemas.append({
                "name": provider_name,
                "display_name": manifest.get("display_name", provider_name),
                "description": manifest.get("description", ""),
                "methods": manifest.get("methods") or [],
                "accounts": accounts,
                "execution": exec_type,
            })

        return schemas
```

**Step 4: Run tests**

```bash
cd back && python -m pytest tests/tools/test_registry.py -v
```
Expected: all 3 tests PASS

**Step 5: Commit**

```bash
git add back/src/tools/registry.py back/tests/tools/test_registry.py
git commit -m "feat: add ToolRegistry to build routing schemas from ToolsConfig"
```

---

## Task 2: Router — gemini-2.0-flash-lite routing logic

Takes a user request + tool schemas → returns a structured routing decision.

**Files:**
- Create: `back/src/tools/router.py`
- Test: `back/tests/tools/test_router.py`

**Step 1: Write failing test**

```python
# back/tests/tools/test_router.py
import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from src.tools.router import ToolRouter, RoutingDecision

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
def router():
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
```

**Step 2: Run to verify failure**

```bash
cd back && python -m pytest tests/tools/test_router.py -v
```
Expected: `ModuleNotFoundError: No module named 'src.tools.router'`

**Step 3: Implement**

```python
# back/src/tools/router.py
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any

import google.generativeai as genai

logger = logging.getLogger(__name__)

ROUTER_MODEL = "gemini-2.0-flash-lite"

SYSTEM_PROMPT = """\
You are a tool router. Given a user request and a list of available tools,
decide which tool and method to call.

Rules:
1. If the request clearly maps to one tool and method → action: "execute"
2. If it is a WRITE operation (send, create, delete, update) and the tool has 2+
   accounts → action: "question" asking which account to use
3. If it is a READ operation and 2+ accounts exist → try to infer from the request
   or context; if unclear → action: "question"
4. If no tool matches the request → action: "none"
5. For action "execute", always include: tool, method, account_id (empty string if
   no accounts), params (JSON object matching the method's parameter schema)

Return valid JSON only, no markdown fences.

Response schema:
{
  "action": "execute" | "question" | "none",
  "tool": "<tool name or empty>",
  "method": "<method name or empty>",
  "account_id": "<account id or empty>",
  "params": {},
  "question": "<question text if action is question>",
  "options": ["<option 1>", ...]
}
"""


@dataclass
class RoutingDecision:
    action: str  # "execute" | "question" | "none"
    tool: str = ""
    method: str = ""
    account_id: str = ""
    params: dict[str, Any] = field(default_factory=dict)
    question: str = ""
    options: list[str] = field(default_factory=list)


class ToolRouter:
    def __init__(self, api_key: str | None = None):
        key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        genai.configure(api_key=key)
        self._model = genai.GenerativeModel(
            model_name=ROUTER_MODEL,
            system_instruction=SYSTEM_PROMPT,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                temperature=0,
            ),
        )

    def decide(
        self,
        request: str,
        context: str,
        tools: list[dict[str, Any]],
    ) -> RoutingDecision:
        tools_text = json.dumps(tools, ensure_ascii=False, indent=2)
        prompt_parts = [
            f"Available tools:\n{tools_text}",
            f"User request: {request}",
        ]
        if context:
            prompt_parts.append(f"Additional context: {context}")

        prompt = "\n\n".join(prompt_parts)

        try:
            response = self._model.generate_content(prompt)
            raw = json.loads(response.text)
        except Exception as exc:
            logger.warning("[Router] Failed to parse response: %s", exc)
            return RoutingDecision(action="none")

        return RoutingDecision(
            action=raw.get("action", "none"),
            tool=raw.get("tool", ""),
            method=raw.get("method", ""),
            account_id=raw.get("account_id", ""),
            params=raw.get("params") or {},
            question=raw.get("question", ""),
            options=raw.get("options") or [],
        )
```

**Step 4: Run tests**

```bash
cd back && python -m pytest tests/tools/test_router.py -v
```
Expected: all 4 tests PASS

**Step 5: Commit**

```bash
git add back/src/tools/router.py back/tests/tools/test_router.py
git commit -m "feat: add ToolRouter using gemini-2.0-flash-lite for tool routing"
```

---

## Task 3: ServerToolExecutor — execute server-side tools with credentials

Dispatches routing decisions to the right Agno Toolkit and calls the correct method.

**Files:**
- Create: `back/src/tools/executor.py`
- Test: `back/tests/tools/test_executor.py`

**Step 1: Write failing test**

```python
# back/tests/tools/test_executor.py
import pytest
from unittest.mock import MagicMock, patch
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
```

**Step 2: Run to verify failure**

```bash
cd back && python -m pytest tests/tools/test_executor.py -v
```
Expected: `ModuleNotFoundError: No module named 'src.tools.executor'`

**Step 3: Implement**

```python
# back/src/tools/executor.py
from __future__ import annotations

import logging
from typing import Any, Callable

from agno.tools import Toolkit

logger = logging.getLogger(__name__)


def _build_web_search(_: dict[str, Any]) -> Toolkit:
    from src.tools.duckduckgo_custom import DuckDuckGoTools
    return DuckDuckGoTools()


def _build_gmail(credentials: dict[str, Any]) -> Toolkit:
    from src.tools.factory import _make_credentials
    try:
        from agno.tools.gmail import GmailTools
        creds = _make_credentials(credentials)
        return GmailTools(creds=creds)
    except ImportError:
        from plugins.gmail.server.tools import GmailTools  # type: ignore[import]
        creds = _make_credentials(credentials)
        return GmailTools(creds=creds)


def _build_github(credentials: dict[str, Any]) -> Toolkit:
    from src.tools.factory import SafeGithubTools
    token = credentials.get("access_token") or credentials.get("token")
    return SafeGithubTools(access_token=token)


# Registry: provider name → builder function
_BUILDERS: dict[str, Callable[[dict[str, Any]], Toolkit]] = {
    "web_search": _build_web_search,
    "gmail": _build_gmail,
    "github": _build_github,
}


def register_executor(name: str, builder: Callable[[dict[str, Any]], Toolkit]) -> None:
    """Register a custom executor builder. Call from plugin server/tools.py at import."""
    _BUILDERS[name] = builder


class ServerToolExecutor:
    def run(
        self,
        tool_name: str,
        method_name: str,
        params: dict[str, Any],
        credentials: dict[str, Any],
    ) -> str:
        builder = _BUILDERS.get(tool_name)
        if not builder:
            raise ValueError(f"No executor registered for: {tool_name}")

        toolkit = builder(credentials)

        method = getattr(toolkit, method_name, None)
        if not callable(method):
            raise ValueError(f"Tool {tool_name} has no method: {method_name}")

        result = method(**params)
        return str(result) if result is not None else ""
```

**Step 4: Run tests**

```bash
cd back && python -m pytest tests/tools/test_executor.py -v
```
Expected: all 4 tests PASS

**Step 5: Commit**

```bash
git add back/src/tools/executor.py back/tests/tools/test_executor.py
git commit -m "feat: add ServerToolExecutor to dispatch routing decisions to toolkits"
```

---

## Task 4: discovery_tool — main orchestrator function

Ties together Registry, Router, and Executor into a single Agno `Function`.

**Files:**
- Create: `back/src/tools/discovery.py`
- Test: `back/tests/tools/test_discovery.py`

**Step 1: Write failing test**

```python
# back/tests/tools/test_discovery.py
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
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
```

**Step 2: Run to verify failure**

```bash
cd back && python -m pytest tests/tools/test_discovery.py -v
```
Expected: `ModuleNotFoundError: No module named 'src.tools.discovery'`

**Step 3: Implement**

```python
# back/src/tools/discovery.py
from __future__ import annotations

import json
import logging
from typing import Any, Callable

from agno.tools import Function

from src.tools.config import ToolConfigClient
from src.tools.executor import ServerToolExecutor
from src.tools.registry import ToolRegistry
from src.tools.router import ToolRouter

logger = logging.getLogger(__name__)


def build_discovery_tool(
    user_id: str,
    config_client: ToolConfigClient,
    client_tool_runner: Callable | None = None,
    *,
    router: ToolRouter | None = None,
    executor: ServerToolExecutor | None = None,
) -> Function:
    """
    Build the discovery_tool Agno Function for a given user session.
    Pass router/executor only in tests to inject mocks.
    """
    _router = router or ToolRouter()
    _executor = executor or ServerToolExecutor()

    async def _discovery_tool(request: str, context: str = "") -> str:
        """
        Execute any available action by describing it in natural language.

        Use this tool whenever you need to interact with external services
        (email, calendar, GitHub, web search, etc.). Describe what you want
        to do in plain language. If the tool needs clarification (e.g., which
        account to use), it will return a question — pass it to the user and
        call this tool again with the answer in `context`.

        Args:
            request: Natural language description of the action to perform.
            context: Optional additional context (e.g., "use work@gmail.com").

        Returns:
            JSON string: {"type": "result", "result": "..."}
                      or {"type": "question", "question": "...", "options": [...]}
                      or {"type": "error", "error": "..."}
        """
        try:
            tools_config = await config_client.fetch_tools(user_id=user_id)
        except Exception as exc:
            logger.warning("[Discovery] Failed to fetch tools: %s", exc)
            return json.dumps({"type": "error", "error": "Failed to load integrations"})

        schemas = ToolRegistry.build(tools_config)
        if not schemas:
            return json.dumps({"type": "error", "error": "No integrations connected"})

        decision = _router.decide(request, context, schemas)

        if decision.action == "question":
            return json.dumps({
                "type": "question",
                "question": decision.question,
                "options": decision.options,
            })

        if decision.action == "none":
            return json.dumps({"type": "error", "error": f"No tool found for: {request}"})

        # Resolve the schema for the selected tool
        tool_schema = next((s for s in schemas if s["name"] == decision.tool), None)
        if not tool_schema:
            return json.dumps({"type": "error", "error": f"Unknown tool: {decision.tool}"})

        # Client-execution path (iOS-native: Calendar, Reminders)
        if tool_schema.get("execution") == "client" and client_tool_runner:
            try:
                result = await client_tool_runner(decision.tool, decision.method, decision.params)
                return json.dumps({"type": "result", "result": result})
            except Exception as exc:
                logger.warning("[Discovery] Client tool error: %s", exc)
                return json.dumps({"type": "error", "error": str(exc)})

        # Server-execution path
        # Find credentials for the selected account
        entry = tools_config.entries.get(decision.tool)
        credentials: dict[str, Any] = {}
        if entry:
            if decision.account_id:
                creds_map = entry.params.get("credentials") or {}
                credentials = creds_map.get(decision.account_id) or entry.params
            else:
                credentials = entry.params

        try:
            result = _executor.run(decision.tool, decision.method, decision.params, credentials)
            return json.dumps({"type": "result", "result": result})
        except Exception as exc:
            logger.warning("[Discovery] Server tool error: %s", exc)
            return json.dumps({"type": "error", "error": str(exc)})

    return Function(
        name="discovery_tool",
        description=(
            "Execute any available action (send email, search GitHub, look up calendar events, "
            "search the web, etc.) by describing what you need in natural language. "
            "Returns result, a clarifying question, or an error."
        ),
        parameters={
            "type": "object",
            "properties": {
                "request": {
                    "type": "string",
                    "description": "Natural language description of what to do",
                },
                "context": {
                    "type": "string",
                    "description": "Additional context, e.g. which account to use",
                },
            },
            "required": ["request"],
        },
        entrypoint=_discovery_tool,
    )
```

**Step 4: Run tests**

```bash
cd back && python -m pytest tests/tools/test_discovery.py -v
```
Expected: all 4 tests PASS

**Step 5: Commit**

```bash
git add back/src/tools/discovery.py back/tests/tools/test_discovery.py
git commit -m "feat: add discovery_tool as the single agent tool entry point"
```

---

## Task 5: Wire discovery_tool into AgentFactory

Replace the per-integration tool building with a single `discovery_tool`. Keep `web_search` inside discovery_tool (served by `ServerToolExecutor`). Remove the client proxy tools block — `discovery_tool` handles the client_tool_runner internally.

**Files:**
- Modify: `back/src/agents/factory.py:300-446`
- Test: `back/tests/agents/test_factory_discovery.py`

**Step 1: Write failing test**

```python
# back/tests/agents/test_factory_discovery.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from agno.tools import Function


@pytest.mark.asyncio
async def test_factory_builds_only_discovery_tool(monkeypatch):
    """When USE_DISCOVERY_TOOL=1, agent receives exactly one tool: discovery_tool."""
    import os
    monkeypatch.setenv("USE_DISCOVERY_TOOL", "1")

    mock_fn = MagicMock(spec=Function)
    mock_fn.name = "discovery_tool"
    monkeypatch.setattr(
        "src.agents.factory.build_discovery_tool",
        lambda **kwargs: mock_fn,
    )

    from src.agents.factory import AgentFactory
    from src.tools.config import ToolConfigClient

    mock_db = None
    mock_model_obj = MagicMock()
    mock_config_client = MagicMock(spec=ToolConfigClient)

    factory = AgentFactory(
        db=mock_db,
        model=mock_model_obj,
        config_client=mock_config_client,
    )

    # Patch SouperAgent to capture tools
    captured_tools = []
    def fake_souper(db, model, tools, **kwargs):
        captured_tools.extend(tools)
        agent = MagicMock()
        agent.name = "genie"
        return agent

    monkeypatch.setattr("src.agents.factory.SouperAgent", fake_souper)

    await factory.build(
        session_id="sess1",
        user_id="user1",
        model_name="gemini-2.0-flash",
        client_tool_runner=AsyncMock(),
    )

    assert len(captured_tools) == 1
    assert captured_tools[0].name == "discovery_tool"
```

**Step 2: Run to verify failure**

```bash
cd back && python -m pytest tests/agents/test_factory_discovery.py -v
```
Expected: FAIL (import error or assertion that tools count != 1)

**Step 3: Modify AgentFactory.build**

In `back/src/agents/factory.py`, find the tools-building section (around line 310) and replace it with a feature-flagged path. Add the import at the top of the file:

```python
# At the top of back/src/agents/factory.py, add:
import os
from src.tools.discovery import build_discovery_tool
```

Replace the tools-building block (lines ~310–446, from `tools: list[Toolkit | Any] = []` to the end of the client proxy tools block) with:

```python
        tools: list[Toolkit | Any] = []

        if os.getenv("USE_DISCOVERY_TOOL") == "1" and user_id and client_tool_runner:
            # Discovery mode: single routing tool replaces all per-integration tools
            discovery_fn = build_discovery_tool(
                user_id=user_id,
                config_client=self._config_client,
                client_tool_runner=client_tool_runner,
            )
            tools = [discovery_fn]
            logger.info("[Factory] Discovery mode: built discovery_tool for user=%s", user_id)
        else:
            # Legacy mode: per-integration tools (existing code below unchanged)
            config_used: ToolsConfig | None = None

            if agent_type and agent_type.lower() == "list" and user_id:
                config = ToolsConfig()
                params = {"user_id": user_id, "list_id": list_id}
                if command_desc and command_desc.get("auth_token"):
                    params["auth_token"] = command_desc["auth_token"]
                config.add("knowledge_search", **params)
                config_used = config
                try:
                    tools = await build_tools(config)
                    logger.info("[Factory] Built %d tools for ListAgent", len(tools))
                except Exception as e:
                    logger.warning("[Factory] Failed to build list tools: %s", e)
            elif not tools_specs and user_id:
                try:
                    tools_config = await self._config_client.fetch_tools(user_id=user_id)
                    config_used = tools_config
                    if model_name and not model_name.startswith("gemma-"):
                        tools_config.add("web_search")
                    tools = await build_tools(tools_config)
                except Exception as e:
                    logger.warning("[Factory] Failed to fetch tools for user %s: %s", user_id, e)
            elif tools_specs:
                config = ToolsConfig()
                for tool_spec in tools_specs:
                    if tool_spec.enabled:
                        params = dict(tool_spec.params)
                        config.add(tool_spec.name, provider=tool_spec.provider, **params)
                if model_name and not model_name.startswith("gemma-"):
                    config.add("web_search")
                config_used = config
                tools = await build_tools(config)

            # Add client proxy tools (existing block)
            if client_tool_runner and config_used and config_used.entries:
                try:
                    from src.plugins.loader import load_plugins, get_manifest
                    from src.plugins.tool_gen import build_client_proxy_tools

                    load_plugins()
                    client_manifests = []
                    integration_ids: dict[str, list[dict]] = {}
                    seen_manifest_names: set[str] = set()
                    for name, tool_item in config_used.entries.items():
                        manifest = get_manifest(name)
                        if not manifest:
                            continue
                        exec_type = (manifest.get("execution") or {}).get("type")
                        if exec_type not in ("client", "hybrid"):
                            continue
                        manifest_name = manifest.get("name", "")
                        if manifest_name not in seen_manifest_names:
                            seen_manifest_names.add(manifest_name)
                            client_manifests.append(manifest)
                        accounts_list = tool_item.params.get("accounts")
                        if accounts_list and isinstance(accounts_list, list):
                            integration_ids[manifest_name] = accounts_list
                        elif tool_item.params.get("integration_id"):
                            existing = integration_ids.get(manifest_name, [])
                            entry = {"id": tool_item.params["integration_id"], "display_name": tool_item.params.get("display_name", "")}
                            if not any(a.get("id") == entry["id"] for a in existing):
                                existing.append(entry)
                            integration_ids[manifest_name] = existing
                        elif name.lower() != manifest_name.lower():
                            account_email = tool_item.params.get("account_email", "")
                            if account_email:
                                display = tool_item.params.get("display_name", account_email)
                                existing = integration_ids.get(manifest_name, [])
                                if not any(a.get("id") == account_email for a in existing):
                                    existing.append({"id": account_email, "display_name": display})
                                integration_ids[manifest_name] = existing
                    if client_manifests:
                        proxy_tools = build_client_proxy_tools(client_manifests, client_tool_runner, integration_ids)
                        tools = list(tools) + proxy_tools
                except Exception as e:
                    logger.warning("[Factory] Failed to add client proxy tools: %s", e)
```

**Step 4: Run tests**

```bash
cd back && python -m pytest tests/agents/test_factory_discovery.py -v
```
Expected: PASS

Run full suite to make sure nothing regressed:

```bash
cd back && python -m pytest -v
```
Expected: all tests PASS (or same failures as before this task)

**Step 5: Commit**

```bash
git add back/src/agents/factory.py back/tests/agents/test_factory_discovery.py
git commit -m "feat: wire discovery_tool into AgentFactory behind USE_DISCOVERY_TOOL env flag"
```

---

## Task 6: Lint and full verification

**Step 1: Lint**

```bash
cd back && ruff check .
```
Fix any issues, then re-run until clean.

**Step 2: Full test suite**

```bash
cd back && python -m pytest -v
```
Expected: all tests pass (or same pre-existing failures — do not introduce new failures).

**Step 3: Build check (Go API — unchanged, verify nothing broke)**

```bash
cd api && go build ./...
```
Expected: success.

**Step 4: Commit lint fixes if any**

```bash
git add -p
git commit -m "fix: lint issues in discovery tool modules"
```

---

## Enabling in production

Set the environment variable to switch to discovery mode:

```bash
USE_DISCOVERY_TOOL=1
```

Without it, the system runs in legacy mode (existing behaviour). This allows gradual rollout and easy rollback.

---

## Files created/modified summary

| Action | Path |
|--------|------|
| Create | `back/src/tools/registry.py` |
| Create | `back/src/tools/router.py` |
| Create | `back/src/tools/executor.py` |
| Create | `back/src/tools/discovery.py` |
| Modify | `back/src/agents/factory.py` |
| Create | `back/tests/tools/test_registry.py` |
| Create | `back/tests/tools/test_router.py` |
| Create | `back/tests/tools/test_executor.py` |
| Create | `back/tests/tools/test_discovery.py` |
| Create | `back/tests/agents/test_factory_discovery.py` |
