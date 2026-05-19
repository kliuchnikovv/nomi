# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language Policy

**The app UI is English-only.** All user-facing strings in `front/` must be in English. No i18n layer exists — do not add Russian or other language strings to JSX/TSX files. The sole exceptions are hard-coded Russian strings already present in `SessionHistorySheet.tsx` (legacy), which will be migrated separately.

## Project Overview

**Nomi** is a hybrid AI assistant combining a cloud brain with local execution. It features a 3-tier architecture:

- **Mobile App** (`front/`) — React Native/Expo/TypeScript client with local tool execution
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

## Mobile App Architecture (`front/`)

### Navigation Structure

```
AppNavigator
└── MainTabs (bottom tabs)
    ├── Dashboard          — DashboardScreen
    ├── Planning           — PlannerScreen
    ├── Chat               — ChatStack
    │   ├── ChatList       — ChatListScreen (session list)
    │   └── ChatDetail     — ChatDetailScreen (wrapped in ChatDetailScreenWrapper)
    ├── Projects           — ProjectsStack
    └── Settings           — SettingsStack
```

**Key files:**
- `front/src/navigation/AppNavigator.tsx` — root navigator (auth gate)
- `front/src/navigation/MainTabs.tsx` — bottom tab bar (hidden when in ChatDetail)
- `front/src/navigation/ChatStack.tsx` — chat sub-stack with `ChatProvider` + `AskUserProvider`

### Chat Screen Flow

`ChatStack` wraps all chat screens in `ChatProvider` (shared context) and `AskUserProvider`.

- **`ChatListScreen`** — lists all sessions; "+" button calls `createNewChatWithMode` then navigates to `ChatDetail` with `emptyChatID`
- **`ChatDetailScreenWrapper`** — route adapter: reads `chatId` from route params, syncs it to `MainContext.activeChatID` via `useEffect`
- **`ChatDetailScreen`** — main chat UI: message list (`GiftedChat`), input toolbar, header with back + title + new-chat button

**New chat button** (top-right of `ChatDetailScreen`): calls `setIsNewSession(true)` then `navigation.replace('ChatDetail', { chatId: emptyChatID })` — replaces current screen in-stack so back goes to `ChatList`.

### State Management

| Context | Location | Responsibility |
|---|---|---|
| `MainContext` | `screens/main/context.tsx` | Chat list, `activeChatID`, `isNewSession`, `pendingChatMode` |
| `ChatContext` | `screens/chat/context.tsx` | Messages, streaming, `sendMessage`, WebSocket lifecycle |
| `AuthContext` | `screens/auth/context.tsx` | User session, token |
| `ThemeContext` | `context/ThemeContext.tsx` | Active theme object |
| `AskUserContext` | `screens/chat/AskUserContext.tsx` | Client tool user-confirmation dialogs |

**Message store:** `useChatStore` (Zustand, `store/chatStore.ts`) — keyed by `chatId`. The empty chat sentinel `emptyChatID = '00000000-0000-0000-0000-000000000000'` is cleared every time it becomes active (see `MainContext` effect) to ensure a clean welcome screen.

### Single Chat Mode (`user.single_chat_mode`)

When enabled, the app starts directly on `ChatDetail` (skipping `ChatList`) and shows a persistent session with history accessible via `SessionHistorySheet`.

- **`isNewSession`** flag controls the welcome screen (greeting + history button + chips)
- `onSessionStarted` callback (passed from `ChatStack` to `ChatProvider`) sets `isNewSession = false` when the first message is sent
- **`SessionHistorySheet`** (`screens/chat/chatDetail/SessionHistorySheet.tsx`) — bottom sheet modal listing past sessions via `GET /api/chats/persistent/all`; items show title or "Session from {date}" fallback

### Theme System

Themes live in `front/src/themes/`. Each theme implements the `Theme` interface (`themes/types.ts`). Active theme is provided by `useTheme()`. Key color slots used throughout: `background`, `surface`, `text`, `textPrimary`, `textSecondary`, `accent`, `border`.

Do not hardcode colors — always use `theme.*` tokens.

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

### Memory Architecture

Nomi uses a **four-layer memory system** built on Agno primitives.  
Full spec: [`docs/superpowers/specs/2026-05-02-agent-memory-architecture.md`](docs/superpowers/specs/2026-05-02-agent-memory-architecture.md)

| Layer | Name | Agno Primitive | Status |
|---|---|---|---|
| 0 | Working | context assembly | Always on |
| 1 | Session (STM) | `PostgresAgentStorage` | Feature-flagged |
| 2 | LTM | `MemoryManager` + `LearningMachine` | Always on |
| 3 | RAG | `Knowledge` + `PgVector` | Always on |
| 4 | Compression | `enable_session_summaries` | Feature-flagged |

**Session backend feature flag** — `users.agent_storage_mode`:
- `'payload'` — history from Go API payload (default). Go fetches last 50 messages, includes them in the Redis frame.
- `'agno'` — Agno's `PostgresDb` owns sessions (keyed by `session_id`). Go omits history from payload; Agno loads it via `add_history_to_context`. Session compression enabled automatically.

**Key files:**
- `back/src/storage/backend.py` — `StorageBackend` protocol, `PayloadBackend`, `AgnoBackend`
- `back/src/storage/factory.py` — `create_storage_backend()`
- `back/src/agents/factory.py` — `AgentFactory.build()` accepts `storage_backend`
- `back/src/agents/nomi.py` — `NomiAgent` with `MemoryManager` + `LearningMachine`
- `back/src/server/redis_session.py` — extracts `agent_storage_mode`, builds backend, guards payload-only paths
- `api/internal/hub/room_handlers.go` — reads `agent_storage_mode`, conditionally includes history
- `api/migrations/003_agent_storage_mode.sql` — adds `agent_storage_mode` column

### Memory & RAG

Nomi uses a **2-layer memory system**:

#### 1. Vector Knowledge Store (`personal_vectors`)
- **Shared Knowledge**: One Agno `Knowledge(vector_db=PgVector(...))` instance per process, table `personal_vectors`
- **Indexing**: `/rag/index` endpoint (device → server), plus background `_extract_and_store_facts()` per message; device clients (`IOSCalendarClient`, `IOSRemindersClient`, `IOSContactsClient`, `IOSHealthClient`, `IMAPEmailClient`) call `ragApi.index()` directly
- **User isolation**: `metadata={"user_id": user_id}` on every `knowledge.insert()` call
- **Runtime filtering**: `AgentRunWrapper` injects `knowledge_filters={"user_id": rag_user_id}` into every `agent.run()`
- **Search**: `search_knowledge_base` tool registered automatically by Agno; user isolation via `knowledge_filters`
- **Vector DB**: PostgreSQL + pgvector + Google Gemini embeddings (768d)

**Files:**
- `back/src/core/container.py` — `Container.knowledge` (creates shared `Knowledge` instance)
- `back/src/agents/factory.py` — `AgentFactory._knowledge`, `AgentRunWrapper` (injects `knowledge_filters` at run)
- `back/src/server/redis_session.py` — `_extract_and_store_facts()`, `extracted_facts` from payload
- `back/app.py` — `/rag/index` endpoint
- `front/src/apiClient.ts` — `ragApi.index()` helper used by all device clients

#### 2. Agno Agentic Memory (MemoryManager + LearningMachine)
- `MemoryManager(model=model, db=db)` — stores user memories in PostgreSQL via Agno
- `enable_agentic_memory=True` — agent can call `add_memory`, `update_memory`, `delete_memory` tools
- Memories injected into prompt as `<memories_from_previous_interactions>`
- `LearningMachine`: auto-learns user profile and entity memory (namespaced `user:{user_id}:personal`) after each run

**File:** `back/src/agents/nomi.py`

### Agent Types

`AgentFactory.build()` dispatches on `agent_type` from the payload:

- **`nomi`** (default) — full `NomiAgent` with `MemoryManager` + `LearningMachine` + RAG
- **`planner`** — lightweight `PlannerAgent` for day-plan editing; stateless patches via `patch_plan_document`
- **`team`** — team mode; `command_desc.type` identifies the team (`development_team`, `dnd_team`, `travel_planning`, `nomi`); member responses stream as `member_response` frames

**Files:**
- `back/src/agents/nomi.py` — `NomiAgent` (full assistant)
- `back/src/agents/planner.py` — `build_planner_agent()` (day planner)
- `back/src/agents/souper.py` — backward-compat shim; re-exports from `nomi.py`
- `back/src/workflows/planning.py` — multi-stage planning workflow (extract → recon → cluster → route → build)

### Planning Workflow (`back/src/workflows/`)

Multi-stage pipeline used when user requests a full day plan:

1. **Extract** — parse tasks from natural language
2. **Recon** — locate places via ORS/maps
3. **Cluster** — group by area
4. **Route** — optimize order
5. **Build** — assemble final plan document

`build_planning_workflow()` returns a runnable workflow object. The `PlannerAgent` handles iterative edits after the plan is built.

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

**Available Plugins:**
- `telegram` — Telegram bot bridge (webhook → Redis → brain → Telegram)
- `calendar`, `ios_calendar`, `ios_reminders`, `ios_contacts`, `ios_health`, `ios_shortcuts` — iOS device integrations (client-side plugins)
- `github`, `gmail`, `imap_email` — server-side service integrations
- `sandbox` — isolated Linux sandbox for code execution

**Key Files (Telegram example):**
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

### 3. Repository Discovery

Repositories are discovered via GitHub integration — **NOT environment variables**:

```python
# Correct
repos = self.github_tool.list_repos(limit=50)

# Wrong
# os.getenv('GITHUB_REPO_NAME')  ❌
```

### 4. Agent Memory Best Practices

- **Shared Knowledge**: `AgentFactory.get_knowledge()` returns the shared Agno Knowledge for insert/delete; pass `metadata={"user_id": user_id}` on every insert and `metadata={"user_id": user_id, ...}` on `remove_vectors_by_metadata`
- **Run-level filters**: `AgentRunWrapper` injects `knowledge_filters={"user_id": rag_user_id}` at every `run`/`arun`, so agentic search is user-scoped without a custom Knowledge subclass
- `AgentFactory.build()` returns an `AgentRunWrapper` (same interface as agent)

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
