# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Genie** is a hybrid AI assistant combining a cloud brain with local execution. It features a 3-tier architecture:

- **Mobile App** (`front/`) — React Native/TypeScript client with local tool execution
- **Go API** (`api/`) — REST/WebSocket hub for routing and state management
- **Python Brain** (`back/`) — Agno-based AI agents with streaming responses

**Key Architecture Pattern: Remote Brain, Local Hands**
- Python agents decide *what* to do (e.g., "send email")
- Mobile client executes actions locally using device credentials
- Results flow back through WebSocket frames

## Development Commands

### API (Go)

```bash
cd api

# Run server
go run cmd/api/main.go

# Build
go build ./...

# Test
go test ./...

# Install dependencies
go mod download
```

### Agent Service (Python)

```bash
cd back

# Setup virtual environment (first time)
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Run service
python app.py

# Test
pytest

# Lint
ruff check .
```

### Mobile App (React Native)

```bash
cd front

# Install dependencies
npm install

# Start dev server
npm start
# Then press 'i' for iOS or 'a' for Android

# Type check
npm run type-check

# Test
npm test
```

### Docker (All Services)

```bash
# Start all services (API, Agent, DB, Redis)
docker-compose up --build

# Stop services
docker-compose down
```

## Architecture Deep Dive

### WebSocket Frame Protocol

All communication uses JSON frames with a unified structure:

```json
{
  "id": 1,
  "kind": "token",           // or "meta", "signal"
  "op": "message",           // or "heartbeat", "stop"
  "payload": {
    "type": "text",          // or "tool_call", "reasoning", "client_action"
    "message": "...",
    "tool": {...},
    "actions": [...]
  }
}
```

**Frame Types:**
- `text` — Standard chat response
- `reasoning` — Agent's thought process (collapsible UI)
- `tool_call` — Server-side tool execution (DuckDuckGo, GitHub)
- `client_action` — Instruction for mobile to execute local tool (Gmail, Calendar)
- `member_response` — Team mode sub-agent responses

**Files:** `api/internal/hub/models.go`, `back/src/server/models.py`, `front/src/types.ts`

### Room/Hub Pattern (Go API)

The Go API uses a persistent `Room` to manage chat sessions:

1. Room maintains WebSocket connections: one persistent to Python, many ephemeral to mobile clients
2. Room multiplexes messages between Python brain and mobile clients
3. Chat history stored in PostgreSQL, streamed via Redis pub/sub
4. System messages (tool outputs) injected by Room

**Key Files:**
- `api/internal/hub/room.go` — Room implementation with message routing
- `api/internal/hub/hub.go` — Hub manages all active rooms
- `api/internal/hub/payloads.go` — Message payload types

### Integration Registry System

All integrations (Gmail, GitHub, Calendar, etc.) are centrally defined in **3 registries**:

1. **Go Registry** (`api/internal/integrations/registry.go`)
   - Storage type: `StorageTypeClientOnly` (device only), `StorageTypeServer` (server only), `StorageTypeHybrid`
   - OAuth configuration and scopes
   - Sync requirements

2. **Python Registry** (`back/src/integrations/registry.py`)
   - Tool type: server-side vs client-side
   - Filtering logic for tool generation

3. **Frontend Registry** (`front/src/services/integrations/registry.ts`)
   - UI metadata (icons, descriptions)
   - Background task support
   - Client tool executor routing

**When adding a new integration**, update all 3 registries. Do NOT hardcode provider names elsewhere.

**Client-Only vs Server Integrations:**
- **Client-Only** (`StorageTypeClientOnly`): Gmail, Calendar — data and credentials stay on device, executed via `ClientToolExecutor`
- **Server** (`StorageTypeServer`): GitHub, DuckDuckGo — executed by Python backend with server-stored tokens

**Files:**
- `api/internal/integrations/oauth_factory.go` — OAuth config generation from registry
- `back/src/tools/factory.py` — Filters client-only integrations from Python tools
- `front/src/services/tools/ClientToolExecutor.ts` — Local tool execution

### RAG (Retrieval-Augmented Generation)

Genie uses a **3-layer hybrid RAG system**:

#### 1. Built-in Agno RAG (Primary Memory)
- **Shared Knowledge**: One Agno `Knowledge` (vector_db + optional contents_db) per process
- **Search isolation**: `Agent.run(..., knowledge_filters={"user_id": user_id})` — Agno applies filters at run
- **Storage isolation**: `UserKnowledgeAdapter` wraps Knowledge and injects `user_id` into metadata on `insert`/`insert_many` (for `update_knowledge`)
- **Explicit store/delete**: Call `agent_factory.get_knowledge()` then `knowledge.insert(..., metadata={"user_id": user_id})` and `knowledge.remove_vectors_by_metadata(metadata={"user_id": user_id, ...})`
- **Vector DB**: PostgreSQL with pgvector + Google Gemini embeddings (768d)

**Files:**
- `back/src/knowledge/factory.py` — `build_knowledge_base()` (vector_db + contents_db), `build_contents_db()`
- `back/src/knowledge/user_knowledge.py` — `UserKnowledgeAdapter` (injects user_id on insert)
- `back/src/agents/factory.py` — Shared Knowledge, `AgentRunWrapper` (injects knowledge_filters at run), `get_knowledge()`

#### 2. Project Knowledge Manager (Explicit Tool)
- Project-specific docs, structure, APIs
- GitHub repository ingestion
- Explicit search via `KnowledgeSearchTool`

**File:** `back/src/rag_service.py`

#### 3. Local/Personal RAG (Device)
- Private data (emails, notes, tasks) on device
- Searched locally via `client_action` when agent calls `ClientRagTools.search()`

**File:** `front/src/services/database/VectorStore.ts`

### Agent Teams

Teams use a **Leader + Members** pattern:

- **Leader**: Orchestrates tasks, decides which member to delegate to
- **Members**: Specialized agents (Mailer, Scheduler, etc.)
- **Delegation**: Leader calls `delegate_task_to_member` tool
- **Streaming**: Member responses streamed as `member_response` type to show "who is speaking"

**Team Types:**
- `DevelopmentTeam` — Software development (Analyst, Architect, Developer, Reviewer)
- `GenieTeam` — General assistant (Mailer, Briefing, Scheduler)
- `D&D Team` — Dungeon & Dragons campaign (DM, Players)

**Files:**
- `back/src/teams/factory.py` — Team builder
- `back/src/teams/development/team.py` — Development team implementation
- `back/src/teams/genie/team.py` — Genie team implementation

### Background Tasks (Mobile)

Client-only integrations can register background processes:

- Periodic tasks (e.g., email sync every 15 min)
- System event listeners (push notifications, app lifecycle)
- Auto-start/stop on integration enable/disable

**File:** `front/src/services/integrations/BackgroundTaskManager.ts`

### Plugin System (`plugins/`)

Plugins are server-side extensions running within the Python back-end that integrate external platforms.

**Structure:** `plugins/<name>/` at repo root with `manifest.yaml`, `server/` (Python), optional `client/` (React Native).

**Loading:**
- Go API loads `manifest.yaml` for REST metadata (`api/internal/plugins/loader.go`)
- Python back-end auto-imports `server/routes.py` as FastAPI routers (`back/src/plugins/loader.py`)

**Data Separation Principle:**
- Plugin data is **completely separated** from core chat data
- All plugin data lives in `plugin_data` table — plugins do NOT write to `chats` or `messages` tables
- Regular chat list shows ONLY core chats, never plugin chats
- Plugin messages are displayed on dedicated plugin screens in the app

**Integration Points:**
1. **Redis Pub/Sub**: Plugin publishes to `chat:request:{virtual_chat_id}`, receives via delivery handler. Virtual chat IDs are deterministic UUIDs (e.g., `uuid5(NAMESPACE_DNS, "telegram:{chat_id}")`)
2. **Plugin Data Table**: `plugin_data` with JSONB `data` column, `plugin_name`, `record_type` fields. Record types: `linked_account`, `message`
3. **Delivery Handlers**: Registered in `back/src/server/delivery.py` `DeliveryRegistry`, called when message has `"source": "<plugin_name>"`. Also persist assistant responses to `plugin_data`

**Telegram Plugin Flow:**
```
Telegram → Webhook → Save user message to plugin_data → Load history from plugin_data →
Redis → Python brain → Redis → DeliveryHandler →
Send to Telegram + save assistant response to plugin_data
```

**Key Files:**
- `plugins/telegram/server/service.py` — Core logic (messages, model selection, linking)
- `plugins/telegram/server/routes.py` — FastAPI routes (webhook, link, status, messages)
- `plugins/telegram/server/delivery.py` — Response delivery to Telegram + plugin_data persistence
- `plugins/telegram/client/components/TelegramMainScreen.tsx` — Plugin UI screen

**Shared Config:** `config/models.json` at repo root, used by Go API, Python back-end, and plugins.

## Critical Patterns

### 1. Asyncio Cancellation (Stop Button)

Always catch and re-raise `asyncio.CancelledError`:

```python
async def task():
    try:
        await some_operation()
    except asyncio.CancelledError:
        logger.warning("Task cancelled")
        raise  # Must re-raise
    except Exception as e:
        if isinstance(e, asyncio.CancelledError):
            raise
        logger.error(f"Error: {e}")
```

**File:** `back/src/server/redis_worker.py`

### 2. SafeGithubTools (Optional Commit Messages)

Use `SafeGithubTools` instead of `GithubTools` to make `message` parameter optional:

```python
from src.tools.factory import SafeGithubTools

tool = SafeGithubTools(access_token=token)
tool.create_file(repo_name="owner/repo", path="file.py", content="...")  # message optional
```

**File:** `back/src/tools/factory.py`

### 3. Context Injection (Development Team)

`DevelopmentTeam.run()` auto-injects system context into messages:

```
[SYSTEM CONTEXT - IMPORTANT]
**Current Project ID**: uuid. ALWAYS use this ID when creating tasks.
**Current Task ID**: uuid. Use this as parent_id for subtasks.
You have access to repositories: [list]. Use ONLY these names.
[END SYSTEM CONTEXT]
```

**File:** `back/src/teams/development/team.py`

### 4. Repository Discovery

Repositories are discovered via GitHub integration — **NOT environment variables**:

```python
# Correct
repos = self.github_tool.list_repos(limit=50)

# Wrong
# os.getenv('GITHUB_REPO_NAME')  ❌
```

### 5. Agent Memory Best Practices

- **Shared Knowledge**: `AgentFactory.get_knowledge()` returns the shared Agno Knowledge for insert/delete; pass `metadata={"user_id": user_id}` on every insert and `metadata={"user_id": user_id, ...}` on remove_vectors_by_metadata
- **Run-level filters**: `AgentRunWrapper` injects `knowledge_filters={"user_id": rag_user_id}` at every `run`/`arun`, so agentic search is user-scoped without a custom Knowledge subclass
- **Update storage**: Agents receive `UserKnowledgeAdapter(shared_knowledge, rag_user_id)` so `update_knowledge` stores facts with user_id in metadata
- `AgentFactory.build()` returns an `AgentRunWrapper` (same interface as agent) and passes Knowledge adapter to all agents

## Configuration Files

- **API Config**: `config/config.yaml` (relative to `api/`)
- **Shared Config**: `config/models.json` (repo root, shared by Go API, Python back-end, and plugins)
- **Environment**: `.env` files (not committed) — see `.env.example` if present
- **Database**: PostgreSQL 16 with pgvector extension
- **Redis**: Used for pub/sub message routing between API, Python, and plugins

## Testing Requirements

Before completing any task, run verification commands:

**Python:**
```bash
cd back
ruff check .
pytest
```

**Go:**
```bash
cd api
go build ./...
go test ./...
```

**TypeScript:**
```bash
cd front
npm run type-check
```

## Important References

For comprehensive coding rules, protocols, and component-specific guidelines, refer to `AGENTS.md`.
