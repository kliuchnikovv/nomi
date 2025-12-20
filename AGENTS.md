# AGENTS.md — AI Agent Contract

> **Purpose**: This file is a machine-readable contract for AI coding agents (Jules, Gemini, etc.). It defines project structure, coding rules, forbidden actions, and testing commands.

---

## Project Overview

**Genie** is a monorepo containing:
- **`front/`** — React Native mobile app (TypeScript)
- **`back/`** — Python AI agent service (Agno framework)
- **`api/`** — Go REST API & WebSocket server (Gin + GORM)
- **`config/`** — Shared configuration files

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
cd api && golangci-lint run
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
cd back && flake8 && black --check .
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
cd front && npm run lint
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
npm install
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

