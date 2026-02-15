# AGENTS.md — AI Agent Contract

> **Purpose**: This file is a machine-readable contract for AI coding agents (Jules, Gemini, etc.). It defines project structure, coding rules, system architecture, and protocols.

---

## Project Overview

**Genie** is a hybrid AI assistant that combines a powerful cloud brain with a privacy-focused local execution environment.

**Core Components:**
- **`front/`** — React Native mobile app (TypeScript/Expo). Acts as the "Body" and "Hands".
- **`back/`** — Python AI agent service (Agno framework). Acts as the "Brain".
- **`api/`** — Go REST API & WebSocket Hub. Acts as the "Nervous System" and "Memory".
- **`config/`** — Shared configuration files.

---

## System Architecture

Genie uses a 3-tier architecture designed for low-latency streaming and high privacy.

### 1. The Hub (`api/`)
- **Role:** Central message router and state manager.
- **Tech:** Go, Gin, GORM, Gorilla WebSocket.
- **Key Pattern:** **Room/Hub**. A persistent `Room` (`api/internal/hub/room.go`) manages the session. It multiplexes a persistent WebSocket connection to the Python brain with ephemeral connections from mobile clients.
- **Data Flow:**
    - Stores chat history in PostgreSQL.
    - Broadcasts messages between Mobile and Python.
    - Handles "System" messages (e.g., tool outputs).

### 2. The Brain (`back/`)
- **Role:** Intelligence, Reasoning, and Decision Making.
- **Tech:** Python, Agno (Agent Framework), FastAPI.
- **Key Pattern:** **Streaming-First**. The brain does not wait for full completion. It streams:
    - `text` (deltas)
    - `reasoning` (thinking process)
    - `tool_calls` (structured requests)
- **Deployment:** Stateless. Context is rebuilt per request via `session_id` (managed by `api`).

### 3. The Client (`front/`)
- **Role:** Interface and **Local Tool Executor**.
- **Tech:** React Native, Expo, SQLite (local cache), VectorStore (local RAG).
- **Key Pattern:** **Remote Brain, Local Hands**.
    - The Python brain decides *what* to do (e.g., "Send email to Bob").
    - It sends a `client_action` frame.
    - The Client executes it using local credentials (stored in SecureStore) and local APIs (Gmail/Calendar).
    - Result is fed back to the chat.

---

## Authentication & Security

### Flow
1. **Mobile Login:** User signs in with Google on the device (`front/src/screens/auth/context.tsx`).
2. **Backend Verification:** ID Token sent to `POST /auth/google` (`api/internal/handlers/oauth_mobile.go`).
3. **Session:** Go backend verifies token and issues a JWT + Refresh Token.
4. **Local Keys:** The Client *also* keeps the Google Access Token in `SecureStore` (via `secureTokenStorage`). This token is used strictly for **Client-Side Tools** (sending emails, checking calendar) and is never sent to the Python backend.

---

## Protocols

### WebSocket Frames
Communication between Go Hub, Python Brain, and Client uses a JSON Frame protocol.

**File:** `api/internal/hub/models.go` / `back/src/server/models.py`

```json
{
  "id": 1,
  "kind": "token",      // or "meta", "signal"
  "op": "message",      // or "heartbeat", "stop"
  "payload": {
    "type": "text",     // or "tool_call", "reasoning", "client_action"
    "message": "Hello", // text content
    "tool": { ... },    // for tool calls
    "actions": [ ... ]  // for UI buttons
  }
}
```

### Streaming Types
- **`text`**: Standard chat response.
- **`reasoning`**: Internal thought process (displayed in collapsible UI).
- **`tool_call`**: Server-side tool execution (e.g., Search Web).
- **`client_action`**: Instruction for the phone to execute a local tool.
- **`member_response`**: In Team mode, responses from sub-agents.

---

## Integrations & Tools

### Integration Architecture

Genie uses a **registry-based integration system** that simplifies adding new providers and clearly separates client-side and server-side integrations.

#### Integration Types

**Client-Only Integrations (`StorageTypeClientOnly`)**:
- **Storage**: Data stored only in SQLite on the device
- **Credentials**: Tokens stored locally in SecureStore, never sent to server
- **Sync**: NOT synchronized with server (PostgreSQL)
- **Execution**: Uses `ClientToolExecutor` on the device
- **Background Tasks**: Can run background processes on device (e.g., periodic email sync)
- **System Events**: Can listen to system events (push notifications, app lifecycle)
- **Examples**: Gmail, Calendar (personal user data)

**Server Integrations (`StorageTypeServer`)**:
- **Storage**: Data stored on server in PostgreSQL
- **Credentials**: Tokens stored on server, can be passed to Python tools
- **Sync**: Synchronized with client for metadata display
- **Execution**: Uses Python tools on server
- **Examples**: GitHub, Jules (API keys for server operations)

**Hybrid Integrations (`StorageTypeHybrid`)**:
- **Storage**: Metadata on server, data on client
- **Use Case**: Future integrations that need both server and client components

#### Integration Registry System

All integrations are registered in three centralized registries:

1. **Go Registry** (`api/internal/integrations/registry.go`):
   - Provider definitions with metadata (StorageType, OAuth config, scopes)
   - Functions: `GetProvider()`, `GetClientOnlyProviders()`, `GetServerProviders()`, `ShouldSync()`

2. **Python Registry** (`back/src/integrations/registry.py`):
   - Tool type definitions (server-side vs client-side)
   - Functions: `is_server_side()`, `should_include_in_tools()`

3. **Frontend Registry** (`front/src/services/integrations/registry.ts`):
   - UI metadata (icons, descriptions, background task support)
   - Functions: `getClientOnlyIntegrations()`, `getServerIntegrations()`, `supportsBackgroundTasks()`

#### Adding a New Integration

To add a new integration, update **3 registries** (instead of 10+ files):

1. **Go Registry** (`api/internal/integrations/registry.go`):
```go
"slack": {
    Name: "slack",
    DisplayName: "Slack",
    Type: "oauth2",
    StorageType: StorageTypeServer, // or StorageTypeClientOnly
    OAuthConfig: &OAuthConfig{...},
    RequiresSync: true,
    SupportsBackgroundTasks: false,
    // ...
}
```

2. **Python Registry** (`back/src/integrations/registry.py`):
```python
"slack": ProviderDefinition(
    name="slack",
    storage_type=StorageType.SERVER,
    tool_type=ToolType.SERVER_SIDE,
    # ...
)
```

3. **Frontend Registry** (`front/src/services/integrations/registry.ts`):
```typescript
slack: {
    id: 'slack',
    storageType: 'server',
    supportsBackgroundTasks: false,
    // ...
}
```

### 1. Server-Side Tools (`back/src/tools/`)
- Executed by the Python backend.
- **Use Case:** Web Search (DuckDuckGo), Public Data, Computation, GitHub operations.
- **Definition:** Standard Agno `Toolkit`.
- **Filtering:** Only integrations with `StorageTypeServer` are included in tools list for Python backend.
- **Registry:** Uses `back/src/integrations/registry.py` to determine which integrations should be included.

### 2. Client-Side Tools (`back/src/tools/client_side.py` & `front/src/services/tools/`)
- **Concept:** "Remote Brain, Local Hands".
- **Storage Type:** Only `StorageTypeClientOnly` integrations execute on client.
- **Workflow:**
    1. Python Agent calls a "Mock" tool (e.g., `ClientGmailTools.send_email`).
    2. This mock records a `ClientAction` in context.
    3. `RedisSession` publishes a `client_action` frame to Redis.
    4. Go Hub receives frame and forwards to Frontend `ChatContext`.
    5. `ChatContext` calls `ClientToolExecutor.ts`.
    6. `ClientToolExecutor` validates integration is client-side via registry.
    7. `ClientToolExecutor` uses local `GmailClient` with local auth tokens.
    8. Result is displayed/fed back to chat.

### 3. Background Tasks (`front/src/services/integrations/BackgroundTaskManager.ts`)
- **Purpose:** Manage background processes for client-only integrations.
- **Features:**
    - Automatic registration based on integration registry
    - Periodic tasks (e.g., email sync every 15 minutes)
    - System event listeners (push notifications, app lifecycle)
    - Lifecycle management (start/stop on integration enable/disable)
- **Usage:**
    - Automatically initialized by `ConnectorsProvider`
    - Tasks registered when integration is enabled
    - Tasks stopped when integration is disabled or deleted
- **Supported Events:**
    - `push_notifications`: Trigger sync on push notification
    - `app_lifecycle`: React to app state changes (foreground/background)

---

## RAG (Retrieval-Augmented Generation)

Genie uses a **Hybrid RAG** approach with multiple layers:

### 1. Built-in Agno RAG (Primary Memory System)

**Framework:** Agno's built-in `Knowledge` system with PgVector and GeminiEmbedder.

**Architecture:**
- **Vector Database:** PostgreSQL with `pgvector` extension
- **Embedder:** Google Gemini `gemini-embedding-001` (768 dimensions)
- **Storage:** `agent_knowledge` table in PostgreSQL
- **Isolation:** `UserScopedKnowledge` wrapper enforces user_id isolation via metadata filters

**How It Works:**

#### Automatic Search (`search_knowledge=True`)
When enabled, Agno automatically:
1. Performs semantic search in the knowledge base before generating responses
2. Retrieves relevant documents (default: 5 results)
3. Injects retrieved context into the prompt automatically
4. No explicit tool calls needed — works transparently

**Example:**
```python
agent = SouperAgent(
    knowledge=UserScopedKnowledge(user_id=user_id, vector_db=vector_db),
    search_knowledge=True,  # Automatic search enabled
    # ...
)
```

#### Automatic Storage (`update_knowledge=True`)
When enabled, Agno automatically:
1. Analyzes conversation history
2. Extracts important facts, preferences, and context
3. Stores them in the knowledge base with metadata (user_id, timestamp)
4. Works transparently — no explicit save calls needed

**Example:**
```python
agent = SouperAgent(
    knowledge=UserScopedKnowledge(user_id=user_id, vector_db=vector_db),
    update_knowledge=True,  # Automatic fact storage enabled
    # ...
)
```

**Agent Integration:**
All agents in Genie support built-in RAG:
- ✅ `SouperAgent` — Full RAG support (search + update)
- ✅ `RagAgent` — Full RAG support
- ✅ `BriefingAgent` — Full RAG support
- ✅ `MailerAgent` — Full RAG support
- ✅ `MemoriserAgent` — Full RAG support
- ✅ `DevelopmentTeam` agents (Analyst, Architect, Developer, Reviewer, Worker, Verifier) — Full RAG support
- ✅ D&D Team agents — Full RAG support

**Files:**
- `back/src/knowledge/factory.py` — Knowledge base factory (`build_vector_db`, `build_knowledge_base`)
- `back/src/knowledge/user_knowledge.py` — `UserScopedKnowledge` wrapper for user isolation
- `back/src/agents/factory.py` — Creates `UserScopedKnowledge` for all agents

### 2. Project Knowledge Manager (`back/src/rag_service.py`)

**Purpose:** Explicit project-scoped knowledge search via tools.

**Features:**
- Project-specific knowledge indexing (docs, structure, API endpoints, components, dependencies)
- GitHub repository ingestion with structured summaries
- Explicit search via `KnowledgeSearchTool` (complements automatic RAG)

**Use Case:** When agents need to search specific project knowledge by `project_id`.

**Example:**
```python
knowledge_tool = KnowledgeSearchTool(user_id=user_id, auth_token=auth_token)
# Agent can explicitly call: knowledge_tool.search_knowledge(query="...", project_id="...")
```

**Files:**
- `back/src/rag_service.py` — `ProjectKnowledgeManager` and `KnowledgeSearchTool`

### 3. Local/Personal RAG (`front/src/services/database/VectorStore.ts`)

**Purpose:** Private user data search on device.

**Architecture:**
- Runs on the phone (SQLite/Vector)
- Stores private user data (Emails, Notes, Tasks)
- **Access:** Python agent calls `ClientRagTools.search()`, which triggers a `client_action`. The phone runs the vector search locally and returns text snippets.

**Files:**
- `front/src/services/database/VectorStore.ts` — Local vector store
- `back/src/tools/client_side.py` — `ClientRagTools` for triggering local search

### RAG Architecture Summary

```
┌─────────────────────────────────────────────────────────┐
│              UserScopedKnowledge (Agno RAG)              │
│  - Automatic search (search_knowledge=True)             │
│  - Automatic storage (update_knowledge=True)            │
│  - User isolation via metadata filters                  │
│  - PgVector + GeminiEmbedder                           │
└─────────────────────────────────────────────────────────┘
                          │
                          │ used by all agents
                          ▼
┌─────────────────────────────────────────────────────────┐
│              All Agno Agents                            │
│  - SouperAgent, BriefingAgent, MailerAgent, etc.        │
│  - DevelopmentTeam agents                               │
│  - D&D Team agents                                      │
└─────────────────────────────────────────────────────────┘
                          │
                          │ explicit search via tools
                          ▼
┌─────────────────────────────────────────────────────────┐
│         KnowledgeSearchTool (Project RAG)               │
│  - Project-specific knowledge                           │
│  - GitHub repository ingestion                         │
│  - Explicit tool calls                                 │
└─────────────────────────────────────────────────────────┘
                          │
                          │ client_action
                          ▼
┌─────────────────────────────────────────────────────────┐
│      ClientRagTools → Local VectorStore (Frontend)      │
│  - Private user data (emails, notes, tasks)            │
│  - Local SQLite/Vector search                          │
└─────────────────────────────────────────────────────────┘
```

### Best Practices

1. **Use Built-in RAG for General Memory:**
   - All agents should have `knowledge` parameter with `UserScopedKnowledge`
   - Enable `search_knowledge=True` and `update_knowledge=True` for automatic memory
   - Works transparently — no explicit tool calls needed

2. **Use KnowledgeSearchTool for Project-Specific Search:**
   - When searching for project documentation, code structure, or API endpoints
   - When you need to filter by `project_id`
   - Complements automatic RAG, doesn't replace it

3. **Use ClientRagTools for Private Data:**
   - When searching user's private emails, notes, or tasks
   - Executes on device for privacy
   - Triggered via `client_action` pattern

---

## Teams & Agents (`back/src/teams/`)

- **Factory Pattern:** `TeamFactory` builds complex agent hierarchies.
- **Structure:**
    - **Leader:** Orchestrates the conversation.
    - **Members:** Specialized agents (e.g., Mailer, Scheduler).
- **Delegation:** Leader uses `delegate_task_to_member` tool. The response is streamed back as `member_response` type, allowing the UI to show *who* is speaking.

---

## Plugin System

Genie supports **plugins** — server-side extensions that run within the Python back-end process and integrate external messaging platforms with the core AI system.

### Architecture

Plugins live in `plugins/<name>/` at the **repository root** (not inside `api/` or `back/`). Each plugin has:

```
plugins/<name>/
├── manifest.yaml      # Plugin metadata (loaded by Go API for registration)
├── package.json       # NPM package for frontend client component (optional)
├── client/            # React Native UI component (optional)
└── server/            # Python server-side logic
    ├── __init__.py
    ├── routes.py      # FastAPI router (auto-registered at startup)
    ├── service.py     # Core logic
    ├── delivery.py    # AI response delivery handler
    └── tools.py       # API client helpers
```

### How Plugins Load

1. **Go API** (`api/internal/plugins/loader.go`): Scans `PLUGINS_DIR` for `manifest.yaml` files, loads metadata for the REST API.
2. **Python back-end** (`back/src/plugins/loader.py`): Scans the same directory, auto-imports `server/routes.py` as FastAPI routers, registers delivery handlers.
3. **Frontend**: Uses `manifest.yaml` + optional `client/` component for UI integration.

### Plugin ↔ Core Integration

Plugins integrate with the core system through three mechanisms:

#### 1. Redis Pub/Sub (Message Routing)
- Plugin publishes user messages to `chat:request:{virtual_chat_id}` → Python brain processes them.
- Python brain publishes responses to `chat:user:{user_id}` → Go Hub routes to mobile clients AND plugin delivery handler.
- Virtual chat IDs are deterministic UUIDs derived from plugin-specific identifiers (e.g., `uuid5(NAMESPACE_DNS, "telegram:{chat_id}")`).

#### 2. Plugin Data Storage (`plugin_data` table)
- **All plugin data lives in `plugin_data`** — plugins do NOT write to `chats` or `messages` tables.
- `plugin_data` table uses JSONB `data` column with `plugin_name` and `record_type` for filtering.
- Record types: `linked_account` (account links, settings), `message` (chat history).
- Plugins read/write `plugin_data` via `asyncpg` directly.
- Plugin messages are served via dedicated API endpoints (e.g., `GET /api/plugins/telegram/messages`).
- **Important**: Plugin data is completely separated from core chat data. Regular chat list shows ONLY core chats, not plugin chats.

#### 3. Delivery Handlers (`back/src/server/delivery.py`)
- Plugins register a `DeliveryHandler` in `DeliveryRegistry`.
- When a message has `"source": "<plugin_name>"` in its payload, `RedisSession` calls the handler to deliver the AI response back to the external platform.
- Delivery handlers also persist assistant responses to `plugin_data` for history display.

### Telegram Plugin

**Flow:**
```
Telegram → Webhook → Plugin service →
  1. Save user message to plugin_data (record_type="message")
  2. Load chat history from plugin_data
  3. Publish to Redis chat:request:{virtual_chat_id}
  4. Python brain → Redis chat:user:{user_id}
  5. DeliveryHandler sends response to Telegram + saves to plugin_data
```

**Account Linking:** `/start` → 6-digit code → user enters in app → creates `plugin_data` record (no `chats` entry).

**Key Files:**
- `plugins/telegram/server/service.py` — Core logic (webhook, linking, message handling)
- `plugins/telegram/server/routes.py` — FastAPI routes (webhook, link, status, messages)
- `plugins/telegram/server/delivery.py` — `TelegramDeliveryHandler` (sends to Telegram + saves to plugin_data)
- `plugins/telegram/client/components/TelegramMainScreen.tsx` — Plugin UI screen

**Important Patterns:**
- All Telegram messages stored in `plugin_data` with `record_type="message"` — NOT in `messages` table
- No entries in `chats` table for Telegram — plugin data is fully separated from core chats
- Virtual chat IDs for Redis routing: `uuid5(NAMESPACE_DNS, "telegram:{telegram_chat_id}")`
- Account deduplication in `link_user()` checks both `telegram_chat_id` and `user_id`
- Frontend plugin screen polls `GET /api/plugins/telegram/messages` for message display

### Shared Configuration

Plugins and core services share config files in `config/` at the repo root:
- `config/models.json` — Available AI models
- Both `api/Dockerfile` and `back/Dockerfile` copy `config/` to `/app/config/`
- `docker-compose.yml` mounts `./config:/config:ro` for the API service

---

## Global Rules

### ALWAYS
- Use explicit types in public APIs
- Write tests for new functionality
- Follow existing code patterns in each directory
- Commit atomic changes (one logical change per commit)

### NEVER
- Do NOT hardcode secrets, API keys, or credentials
- Do NOT modify `go.sum`, `package-lock.json`, or `requirements.txt` directly (use package managers)
- Do NOT delete or rename files without explicit instruction
- Do NOT break the Protocol: Do not change the JSON Frame structure without updating Go, Python, and Frontend.

---

## Component: `api/` (Go Backend)

### Context
- **Framework**: Gin (HTTP), GORM (ORM), gorilla/websocket
- **Architecture**: Modular monolith with plugin system
- **Entry point**: `api/cmd/api/main.go`
- **Config path**: `../config/config.yaml` (relative to api/)

### Coding Rules
- Follow Go idioms: short variable names, error handling with `if err != nil`
- Use `zap` for logging (structured logs)
- New handlers go in `api/internal/handlers/`
- New models go in `api/internal/storage/models.go`
- **Integrations**: Use `api/internal/integrations/registry.go` for provider definitions
- **OAuth**: Use `api/internal/integrations/oauth_factory.go` for OAuth configuration generation

### Testing
```bash
cd api && go test ./...
```

### Linting
```bash
cd api && go build ./...
```

### Forbidden Actions
- Do NOT use `panic()` for error handling
- Do NOT use global variables for state

---

## Component: `back/` (Python Agent)

### Context
- **Framework**: Agno (AI agent orchestration), FastAPI
- **Architecture**: Teams of agents with tools
- **Entry point**: `back/app.py`
- **Main agent**: `back/src/agents/souper.py`

### Agent Memory (RAG Integration)

All agents in Genie support built-in memory via Agno's RAG system:

**Creating Agents with Memory:**
```python
from src.knowledge.factory import build_vector_db
from src.knowledge.user_knowledge import UserScopedKnowledge

# Build vector database
vector_db = build_vector_db(db_url=db_url)

# Create user-scoped knowledge (enforces user_id isolation)
knowledge = UserScopedKnowledge(user_id=user_id, vector_db=vector_db)

# Create agent with memory
agent = SouperAgent(
    model=model,
    knowledge=knowledge,
    search_knowledge=True,   # Automatic search in knowledge base
    update_knowledge=True,   # Automatic fact storage from conversations
    # ...
)
```

**How Memory Works:**
- **Automatic Search:** When `search_knowledge=True`, Agno automatically searches the knowledge base before generating responses
- **Automatic Storage:** When `update_knowledge=True`, Agno automatically extracts and stores important facts from conversations
- **User Isolation:** `UserScopedKnowledge` ensures each user's data is isolated via metadata filters
- **No Explicit Calls:** Memory works transparently — no need to call tools explicitly

**Agent Factory Pattern:**
`AgentFactory.build()` automatically creates `UserScopedKnowledge` for all agents:
- Uses `user_id` or `session_id` for anonymous users
- Creates `UserScopedKnowledge` wrapper for user isolation
- Passes `knowledge` to all agent constructors

**Files:**
- `back/src/agents/factory.py` — Agent factory with automatic knowledge creation
- `back/src/knowledge/factory.py` — Knowledge base factory functions
- `back/src/knowledge/user_knowledge.py` — `UserScopedKnowledge` wrapper

### Coding Rules
- Use type hints for all function signatures
- Use Pydantic models for data validation
- Async functions preferred for I/O operations
- Use `logging` module, not `print()`
- **Integrations**: Use `back/src/integrations/registry.py` to check integration types
- **Tools**: Client-side integrations are filtered out in `tools/factory.py` - only server-side tools are built
- **Memory**: Always pass `knowledge` parameter to agents when `user_id` is available. Use `UserScopedKnowledge` for user isolation.

### Testing
```bash
cd back && pytest
```

### Linting
```bash
cd back && ruff check .
```

### Forbidden Actions
- Do NOT use synchronous blocking calls in async functions
- Do NOT modify `src/teams/` structure without explicit instruction
- Do NOT create agents without `knowledge` parameter when `user_id` is available — all agents should have memory support

---

## Component: `front/` (React Native Mobile)

### Context
- **Framework**: React Native + TypeScript
- **State**: React Context (AuthContext, ChatContext)
- **Navigation**: React Navigation
- **Styling**: StyleSheet (no external CSS frameworks)

### Coding Rules
- Functional components only (no class components)
- Use TypeScript strict mode
- Screens go in `front/src/screens/`
- Reusable components go in `front/src/components/`
- Hooks go in `front/src/hooks/` or screen-specific `hooks/` folders
- **Integrations**: Use `front/src/services/integrations/registry.ts` for metadata
- **Background Tasks**: Use `front/src/services/integrations/BackgroundTaskManager.ts` for managing background processes
- **Client Tools**: Only client-only integrations execute via `ClientToolExecutor`

### Testing
```bash
cd front && npm test
```

### Linting
```bash
cd front && npm run type-check
```

### Forbidden Actions
- Do NOT run `npm run ios` or `npm run android` (no simulator in agent VM)
- Do NOT modify `ios/` or `android/` native code without explicit instruction
- Do NOT use Storyboards or XIBs

### Build Verification
If CI reports build errors, analyze the error log and propose fixes. Do NOT guess — use the exact error message.

---

## Environment Setup (for Agent VM)

Run this script to initialize the development environment:

```bash
#!/bin/bash
set -e

# Go
cd api && go mod download

# Python
cd ../back
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Node (React Native)
cd ../front
npm install --legacy-peer-deps
```

---

## CI/CD Integration

### GitHub Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `backend-ci.yml` | PR changes to `api/` or `back/` | Run tests & linters |
| `backend-preview.yml` | PR opened/updated | Deploy preview to Railway |
| `pr-cleanup.yml` | PR closed | Delete preview environment |

### Pull Request Workflow
1. Agent creates PR with changes
2. CI runs tests for affected components (`backend-ci.yml`)
3. Backend preview deploys to Railway (link posted in PR comment)
4. Human reviews and merges
5. Preview environment automatically deleted

### Handling CI Failures
If CI fails:
1. Read the full error log
2. Identify the failing component and line
3. Propose a fix based on the error message
4. Do NOT retry without understanding the cause

### Required Secrets
- `RAILWAY_TOKEN`: Railway API token for preview deployments

# Agent Instructions

Before marking any task as complete, you MUST execute the following verification steps in the terminal:

1. **Python:** `ruff check .` AND `pytest`
2. **Go:** `go build ./...` AND `go test ./...`
3. **TypeScript:** `npm run type-check` (or `tsc --noEmit`)

If any command fails (non-zero exit code), you must fix the code and retry. Do not ask for confirmation until tests pass.

---

## Critical Patterns & Fixes

### 1. Asyncio Cancellation (Stop Button)

When handling user cancellation in async code, always catch `asyncio.CancelledError` explicitly and re-raise it:

```python
async def wrapped_task():
    try:
        await some_operation()
    except asyncio.CancelledError:
        logger.warning("Task cancelled correctly")
        raise  # IMPORTANT: Always re-raise CancelledError
    except Exception as e:
        # Guard against CancelledError slipping through
        if isinstance(e, asyncio.CancelledError):
            raise
        logger.error(f"Error: {e}")
```

**File:** `back/src/server/redis_worker.py`

---

### 2. SafeGithubTools (Optional Commit Messages)

Use `SafeGithubTools` instead of `GithubTools` to make `message` parameter optional for file operations:

```python
from src.tools.factory import SafeGithubTools

# OK - message is optional
tool = SafeGithubTools(access_token=token)
tool.create_file(repo_name="owner/repo", path="file.py", content="...")
```

**File:** `back/src/tools/factory.py`

---

### 3. Context Injection (Project ID & Task ID)

`DevelopmentTeam.run()` automatically injects context into messages:

```
[SYSTEM CONTEXT - IMPORTANT]
**Current Project ID**: `uuid`. ALWAYS use this ID when creating tasks.
**Current Task ID**: `uuid`. Use this as parent_id for subtasks.
You have access to the following repositories: [...]. Use ONLY these names.
[END SYSTEM CONTEXT]
```

**File:** `back/src/teams/development/team.py`

---

### 4. GitHub Integration (Repository Discovery)

Repositories are discovered via GitHub integration — **NOT** from environment variables:

```python
# Correct: Use list_repos from GitHub integration
repos = self.github_tool.list_repos(limit=50)

# WRONG: Do NOT use env vars for repo names
# os.getenv('GITHUB_REPO_NAME')  ❌
```

**File:** `back/src/teams/development/team.py`

---

### 5. Agent Memory (RAG Integration)

**IMPORTANT**: All agents should support memory via Agno's built-in RAG system.

**Creating Agents with Memory:**

```python
from src.knowledge.factory import build_vector_db
from src.knowledge.user_knowledge import UserScopedKnowledge

# Build vector database (shared across users)
vector_db = build_vector_db(db_url=db_url)

# Create user-scoped knowledge (enforces user_id isolation)
knowledge = UserScopedKnowledge(user_id=user_id, vector_db=vector_db)

# Create agent with memory enabled
agent = SouperAgent(
    model=model,
    knowledge=knowledge,
    search_knowledge=True,   # Automatic search enabled
    update_knowledge=True,   # Automatic storage enabled
    # ...
)
```

**Agent Factory Pattern:**

`AgentFactory.build()` automatically creates knowledge for all agents:

```python
# In AgentFactory.build()
rag_user_id = user_id or session_id
vector_db = self._get_or_create_vector_db()
knowledge = None
if vector_db:
    knowledge = UserScopedKnowledge(user_id=rag_user_id, vector_db=vector_db)

# Pass to all agents
agent = SouperAgent(
    model=model,
    knowledge=knowledge,  # Automatically provided
    # ...
)
```

**DevelopmentTeam Pattern:**

When creating DevelopmentTeam, knowledge is created and passed to all sub-agents:

```python
# In DevelopmentTeam.__init__()
knowledge = None
if user_id:
    try:
        vector_db = build_vector_db(db_url=db_url)
        if vector_db:
            knowledge = UserScopedKnowledge(user_id=user_id, vector_db=vector_db)
    except Exception as e:
        logger.warning("Failed to create knowledge base: %s", e)

# Pass to all agents
self.analyst = AnalystAgent(..., knowledge=knowledge)
self.architect = ArchitectAgent(..., knowledge=knowledge)
# ... etc
```

**Key Points:**
- Always use `UserScopedKnowledge` for user isolation (never use raw `Knowledge`)
- Enable both `search_knowledge` and `update_knowledge` for full memory support
- Memory works automatically — no explicit tool calls needed
- `KnowledgeSearchTool` is for explicit project-specific search (complements automatic RAG)

**Files:**
- `back/src/agents/factory.py` — Agent factory with automatic knowledge creation
- `back/src/teams/development/team.py` — DevelopmentTeam with knowledge for all agents
- `back/src/knowledge/user_knowledge.py` — UserScopedKnowledge implementation

---

### 6. Integration Registry System

**IMPORTANT**: All integrations must be registered in the three registries. Do NOT hardcode provider names or OAuth configurations.

**Adding a new integration:**
1. Add to `api/internal/integrations/registry.go` with StorageType
2. Add to `back/src/integrations/registry.py` with tool type
3. Add to `front/src/services/integrations/registry.ts` with UI metadata

**OAuth Configuration:**
- Use `integrations.OAuthFactory` instead of manually creating OAuth configs
- OAuth configs are automatically generated from registry

**Tool Filtering:**
- Client-only integrations are automatically filtered out in `handlers/tools.go`
- Only server integrations are passed to Python backend
- Client integrations execute locally via `ClientToolExecutor`

**Background Tasks:**
- Client-only integrations can register background tasks via `BackgroundTaskManager`
- Tasks are automatically managed based on integration state (enabled/disabled)
- System event listeners are registered from integration metadata

**Files:**
- `api/internal/integrations/registry.go` - Go registry
- `api/internal/integrations/oauth_factory.go` - OAuth factory
- `api/internal/integrations/sync.go` - Sync utilities
- `back/src/integrations/registry.py` - Python registry
- `front/src/services/integrations/registry.ts` - Frontend registry
- `front/src/services/integrations/BackgroundTaskManager.ts` - Background task manager
