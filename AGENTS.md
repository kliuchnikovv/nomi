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

### 1. Server-Side Tools (`back/src/tools/`)
- Executed by the Python backend.
- **Use Case:** Web Search (DuckDuckGo), Public Data, Computation.
- **Definition:** Standard Agno `Toolkit`.

### 2. Client-Side Tools (`back/src/tools/client_side.py` & `front/src/services/tools/`)
- **Concept:** "Remote Brain, Local Hands".
- **Workflow:**
    1. Python Agent calls a "Mock" tool (e.g., `ClientGmailTools.send_email`).
    2. This mock records a `ClientAction` in context.
    3. `RedisSession` publishes a `client_action` frame to Redis.
    4. Go Hub receives frame and forwards to Frontend `ChatContext`.
    5. `ChatContext` calls `ClientToolExecutor.ts`.
    6. `ClientToolExecutor` uses local `GmailClient` with local auth tokens.
    7. Result is displayed/fed back to chat.

---

## RAG (Retrieval-Augmented Generation)

Genie uses a **Hybrid RAG** approach:

1. **Global/Server RAG (`back/src/rag_service.py`):**
    - Uses `LightRAG` (remote service).
    - Stores shared or public knowledge.
    - Accessed via REST API from Python.

2. **Local/Personal RAG (`front/src/services/database/VectorStore.ts`):**
    - Runs on the phone (SQLite/Vector).
    - Stores private user data (Emails, Notes, Tasks).
    - **Access:** Python agent calls `ClientRagTools.search()`, which triggers a `client_action`. The phone runs the vector search locally and returns text snippets.

---

## Teams & Agents (`back/src/teams/`)

- **Factory Pattern:** `TeamFactory` builds complex agent hierarchies.
- **Structure:**
    - **Leader:** Orchestrates the conversation.
    - **Members:** Specialized agents (e.g., Mailer, Scheduler).
- **Delegation:** Leader uses `delegate_task_to_member` tool. The response is streamed back as `member_response` type, allowing the UI to show *who* is speaking.

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
- **Main agent**: `back/src/agents/genie.py`

### Coding Rules
- Use type hints for all function signatures
- Use Pydantic models for data validation
- Async functions preferred for I/O operations
- Use `logging` module, not `print()`

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
