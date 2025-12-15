# Genie Monorepo

This repository hosts the complete ecosystem for the **Genie** application. It is structured as a monorepo containing the mobile frontend, the Python-based AI agent backend, and the Go-based core API service.

## Directory Structure

*   **`front/`**: **Genie Mobile**. A React Native application built with TypeScript.
*   **`back/`**: **Genie Agent**. A Python application using the `agno` framework to orchestrate AI agents.
*   **`api/`**: **Genie API**. A Go-based REST API and WebSocket server acting as the central hub.
*   **`config/`**: Shared configuration files for the services.

---

## 1. Genie Mobile (`front/`)

The mobile client for Genie.

*   **Tech Stack**: React Native, TypeScript, React Context API.
*   **Key Features**: Chat interface, Auth management, Real-time updates (planned).

### Getting Started

```bash
cd front
npm install
# Run on iOS
npm run ios
# Run on Android
npm run android
```

---

## 2. Genie Agent (`back/`)

The intelligence layer powered by the `agno` framework. It defines "teams" of agents that can perform tasks using various tools.

*   **Tech Stack**: Python, Agno, FastAPI, SQLAlchemy.
*   **Core Components**:
    *   `AgentOS`: Orchestrates agent lifecycles.
    *   `GenieTeam`: A specialized team of agents (e.g., using Google Maps).
*   **Database**: Uses Postgres (shared or separate, configured via env).

### Getting Started

```bash
cd back
# Install dependencies
pip install -r requirements.txt
# Run application
python app.py
```

---

## 3. Genie API (`api/`)

The high-performance core service that connects the mobile app, database, and AI components.

*   **Tech Stack**: Go, Gin, GORM, WebSocket.
*   **Key Features**:
    *   **Plugin System**: Extensible architecture (Gmail, IMAP plugins).
    *   **Authentication**: JWT & OAuth2 management.
    *   **Chat Management**: Persists chat history and handles real-time messaging.

### Configuration

Copy and edit the config file:
```bash
cp config/config.example.yaml config/config.yaml
```

### Getting Started

```bash
cd api
# Run directly
go run ./cmd/api/main.go
# Or build binary
go build -o ../genie-api ./cmd/api/...
```

---

## Development Notes

*   **Configuration**: Check the `config/` directory for shared settings.
*   **Database**: Ensure your Postgres instance is running and configured in `config.yaml` (for API) and environment variables (for Python Agent).
