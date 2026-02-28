# Discovery Tool Design

**Date:** 2026-02-28
**Status:** Approved

## Problem

The main model currently receives 10–30 tool definitions in its prompt (one per integration method). This bloats the context window, leaks tool internals to the main model, and makes multi-account routing ad hoc.

## Solution

Replace all tools with a single `discovery_tool`. The main model describes what it wants in natural language; `discovery_tool` uses `gemini-2.0-flash-lite` to route the request to the correct tool, handle multi-account disambiguation, and execute the call.

---

## Architecture

### Before
```
Main model → [gmail_send, gmail_search, github_list_repos, calendar_create, ...]
```

### After
```
Main model → [discovery_tool]
                    ↓
           gemini-2.0-flash-lite (router)
                    ↓
          ┌─────────────────────┐
          │    ToolRegistry     │  ← built from plugin manifests
          └─────────────────────┘
                    ↓
       Execute / Question / Error
```

### discovery_tool interface

```python
async def discovery_tool(request: str, context: str = "") -> str:
    ...
```

Returns JSON, one of three shapes:

```json
{"type": "result",   "result": "Email sent to pete@example.com"}
{"type": "question", "question": "Which account?", "options": ["work@...", "personal@..."]}
{"type": "error",    "error": "No tool found for: send email"}
```

When the tool returns `question`, the main model asks the user and calls `discovery_tool` again with the answer in `context`.

---

## Token Storage

OAuth tokens (access + refresh) are **already stored** in the `integrations.params` JSON field in PostgreSQL after the existing `/api/oauth/:provider/callback-mobile` flow. No new endpoints or tables are needed.

Python reads tokens from `integrations.params` and refreshes them via Google OAuth API when `token_expiry` is near:

```python
# back/src/integrations/token_manager.py
async def get_valid_token(user_id: str, integration_id: str) -> str:
    integration = await db.get_integration(user_id, integration_id)
    params = integration.params
    if datetime.now() > params["token_expiry"] - timedelta(minutes=5):
        params = await refresh_token(params)
        await db.update_integration_params(integration_id, params)
    return params["access_token"]
```

---

## discovery_tool Internals

**File:** `back/src/tools/discovery.py`

```python
async def discovery_tool(request: str, context: str = "") -> str:
    integrations = await db.get_user_integrations(user_id)
    tool_schemas = ToolRegistry.get_schemas(integrations)

    decision = await router.decide(request, context, tool_schemas)
    # decision: {action, tool, method, account, params, question, options}

    if decision["action"] == "question":
        return json.dumps({"type": "question",
                           "question": decision["question"],
                           "options": decision["options"]})

    if decision["action"] == "none":
        return json.dumps({"type": "error",
                           "error": f"No tool found for: {request}"})

    if tool_schema.execution == "client":
        result = await session.send_client_action(
            tool=decision["tool"],
            method=decision["method"],
            params=decision["params"],
        )
    else:
        token = await token_manager.get_valid_token(user_id, decision["account"])
        result = await ToolExecutor.run(
            decision["tool"], decision["method"], decision["params"], token
        )

    return json.dumps({"type": "result", "result": result})
```

**ToolRegistry** — singleton built at startup from plugin manifests. `get_schemas(integrations)` returns only schemas for the user's connected providers.

**Router** — calls `gemini-2.0-flash-lite` with a structured system prompt and the list of tool schemas + user accounts. Returns a routing decision JSON.

**ToolExecutor** — maps provider name to an executor class:
```python
_executors = {
    "gmail":  GmailExecutor,
    "github": GithubExecutor,
    # ios_calendar → client_action path
}
```

**AgentFactory** registration:
```python
tools = [build_discovery_tool(user_id, session)]
agent = Agent(model=main_model, tools=tools)
```

---

## Multi-Account Handling

| Scenario | Behavior |
|---|---|
| Write op, 1 account | Execute immediately |
| Write op, 2+ accounts | Always return `question` |
| Read op, 1 account | Execute immediately |
| Read op, 2+ accounts | Router infers from context; `question` if unclear |

---

## Execution Matrix

| Integration | Tokens | Execution path |
|---|---|---|
| Gmail | PostgreSQL (`integrations.params`) | Python executor (server) |
| GitHub | PostgreSQL (`integrations.params`) | Python executor (server) |
| iOS Calendar | Device (EventKit) | `client_action` (unchanged) |
| iOS Reminders | Device (EventKit) | `client_action` (unchanged) |

`client_action` is preserved for iOS-native integrations that cannot be called from the server. The main model is unaware of the distinction.

---

## Files to Create / Modify

### New files
- `back/src/tools/discovery.py` — `discovery_tool` function
- `back/src/tools/registry.py` — `ToolRegistry` singleton
- `back/src/tools/router.py` — gemini-flash-lite routing logic
- `back/src/tools/executor.py` — `ToolExecutor` dispatch map
- `back/src/integrations/token_manager.py` — token fetch + refresh

### Modified files
- `back/src/agents/factory.py` — replace tool list with `[build_discovery_tool(...)]`
- `back/src/tools/factory.py` — remove per-integration tool building for client/hybrid providers
- `plugins/gmail/server/` — add `GmailExecutor` (server-side Gmail API calls)
- `plugins/github/server/` — `GithubExecutor` already exists, wire into `ToolExecutor`

### Unchanged
- Go API OAuth flow (`api/internal/handlers/oauth_mobile.go`)
- `client_action` WebSocket protocol
- iOS-native plugin executors on frontend
- Plugin manifests
