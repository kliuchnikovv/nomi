import json
import os
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Optional, Any

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from agno.os import AgentOS
from starlette.middleware.sessions import SessionMiddleware

from src.agents.souper import SouperAgent

from dotenv import load_dotenv
from src.core.config import Config
from src.core.container import Container
from src.plugins.loader import load_plugins, register_plugin_routes

# Загружаем переменные окружения из .env файла, если он существует
# Если файл не найден, используем переменные окружения из системы (для продакшн)
load_dotenv()

# Global singleton for Vector DB to avoid connection pool exhaustion
global_vector_db: Optional[Any] = None


# ---- Logging ----
class RailwayJsonFormatter(logging.Formatter):
    """JSON formatter for Railway-compatible logs"""

    LEVEL_MAP = {
        logging.DEBUG: "debug",
        logging.INFO: "info",
        logging.WARNING: "warn",
        logging.ERROR: "error",
        logging.CRITICAL: "fatal",
    }

    def format(self, record: logging.LogRecord) -> str:
        import json
        from datetime import datetime

        # Base JSON structure with top-level severity for Railway
        log_entry = {
            "level": self.LEVEL_MAP.get(record.levelno, "info").upper(),
            "message": record.getMessage(),
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "logger": record.name,
        }

        # Add exception info if present
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)
            # Duplicate error message in attributes for backward compat if needed,
            # but primary "level" must be at root.

        # Add extra attributes from record if they exist (custom args)
        if hasattr(record, "custom_attrs"):
            log_entry.update(record.custom_attrs)

        return json.dumps(log_entry, ensure_ascii=False)


def _init_logging():
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    root = logging.getLogger()
    root.setLevel(level)
    if not root.handlers:
        h = logging.StreamHandler()
        fmt = RailwayJsonFormatter()
        h.setFormatter(fmt)
        root.addHandler(h)

    # Configure third-party library loggers
    logging.getLogger("agno").setLevel(level)

    # Silence noise but allow propagation for Uvicorn errors to use our JSON formatter
    for logger_name in ["uvicorn", "uvicorn.error", "uvicorn.access"]:
        log = logging.getLogger(logger_name)
        log.handlers = []  # Remove default Uvicorn handlers
        log.propagate = True  # Let it bubble up to root (which has our JSON formatter)
        log.setLevel(logging.WARNING)

    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("hpack").setLevel(logging.WARNING)

    logging.info("Logging initialized at %s", level_name)


_init_logging()

# Инициализация конфигурации и контейнера
config = Config.from_env()
container = Container(config=config)

# Инициализация AgentOS для совместимости с существующим кодом
agent_os = AgentOS(
    agents=[
        SouperAgent(
            db=container.db,
            model=container.model,
            debug_mode=config.debug_mode,
        ),
    ],
)
global app
app = agent_os.get_app()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("[Lifespan] Starting up...")

    logging.warning("[Lifespan] Loading plugins...")
    try:
        load_plugins()
        register_plugin_routes(app)
        logging.warning("[Lifespan] Plugins loaded and routes registered successfully")
    except Exception as e:
        logging.error("[Lifespan] Failed to load plugins: %s", e, exc_info=True)

    logging.warning("[Lifespan] Initializing Redis Worker...")
    try:
        # Используем redis_worker из container
        redis_worker = container.redis_worker
        await redis_worker.start()
        logging.warning("[Lifespan] Redis Worker started successfully")
    except Exception as e:
        print(f"[Lifespan] Error starting Redis Worker: {e}")
        logging.error(f"[Lifespan] Failed to start Redis Worker: {e}", exc_info=True)

    yield

    # Shutdown
    print("[Lifespan] Shutting down...")
    logging.warning("[Lifespan] Shutting down resources...")
    await container.close()


# Assign lifespan to the app
# Note: agent_os.get_app() returns a FastAPI app.
# We need to manually set the lifespan if it wasn't set, or we might override it.
# Check if agent_os set one? Unlikely for basic usage.
app.router.lifespan_context = lifespan


# Health check endpoint for Railway zero-downtime deployments
@app.get("/health")
async def health_check():
    from datetime import datetime

    return {"status": "ok", "time": datetime.utcnow().isoformat()}


class EmailAnalyzeRequest(BaseModel):
    subject: str = ""
    snippet: str = ""
    from_email: str = ""
    from_name: str = ""
    labels: list[str] = []


class EmailAnalyzeResponse(BaseModel):
    is_important: bool
    urgent: bool
    priority: int
    action_hint: str
    due_date_iso: str


@app.post("/emails/analyze")
async def analyze_email(
    request: EmailAnalyzeRequest,
    x_user_id: Optional[str] = Header(None, alias="X-User-ID"),
):
    """Analyze email importance using gpt-5-nano and return reminder metadata."""
    if not x_user_id:
        raise HTTPException(status_code=401, detail="X-User-ID header is required")

    labels_str = ", ".join(request.labels) if request.labels else "none"
    prompt = f"""Analyze this email and determine if it requires user action.
Subject: {request.subject}
From: {request.from_name} <{request.from_email}>
Snippet: {request.snippet}
Labels: {labels_str}

Reply with JSON only, no other text:
{{"is_important": boolean, "urgent": boolean, "priority": 1 to 4, "action_hint": "one short sentence in same language as email", "due_date_hours": integer or null}}

is_important = true ONLY for: payment due, invoice, subscription renewal, account verification, request needing reply, deadline, meeting invite.
is_important = false for: CATEGORY_PROMOTIONS, CATEGORY_UPDATES, CATEGORY_SOCIAL, CATEGORY_FORUMS, newsletters, marketing, shipping updates, completed receipts.
urgent = true only if requires action within hours.
priority: 1=urgent (hours), 2=important (today), 3=moderate (days), 4=low.
due_date_hours: hours from now until due, null if not time-sensitive."""

    try:
        from agno.agent import Agent
        model = container.agent_factory.build_model("gpt-5-nano")
        result = await Agent(model=model).arun(prompt)
        text = result.content if result else ""
        match = text[text.find("{"):text.rfind("}") + 1] if "{" in text else ""
        data = json.loads(match) if match else {}
    except Exception as e:
        logging.error("Email analysis failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")

    urgent = bool(data.get("urgent", False))
    due_date = datetime.utcnow()
    hours = data.get("due_date_hours")
    if hours and isinstance(hours, (int, float)) and hours > 0:
        due_date += timedelta(hours=hours)
    elif urgent:
        due_date += timedelta(hours=4)
    else:
        due_date += timedelta(days=1)
        due_date = due_date.replace(hour=9, minute=0, second=0, microsecond=0)

    return EmailAnalyzeResponse(
        is_important=bool(data.get("is_important", False)),
        urgent=urgent,
        priority=max(1, min(4, int(data.get("priority", 4)))),
        action_hint=str(data.get("action_hint", "")),
        due_date_iso=due_date.isoformat() + "Z",
    )


@app.get("/planning/session/{chat_id}")
async def get_planning_session(
    chat_id: str,
    x_user_id: Optional[str] = Header(None, alias="X-User-ID"),
) -> dict:
    """Return the current planning session state for the given chat.

    The session state is loaded from the PlanningWorkflow's persistent storage
    (if a DB is configured) or returned as an empty dict if no session exists yet.
    """
    if not x_user_id:
        raise HTTPException(status_code=401, detail="X-User-ID header is required")

    try:
        from src.workflows.planning import build_planning_workflow

        workflow = build_planning_workflow(
            session_id=chat_id,
            db=None,  # skip: container.db is sync; Agno workflow expects async db
        )
        state = workflow.session_state or {}

        return {
            "chat_id": chat_id,
            "user_id": x_user_id,
            "session_state": state,
            "status": state.get("status", "gathering"),
            "planning_date": state.get("planning_date", ""),
            "tasks": state.get("tasks", []),
            "plan": state.get("plan", []),
            "draft_plans": state.get("draft_plans", []),
            "reminders_ids": state.get("reminders_ids", []),
        }
    except Exception as exc:
        logging.error("Failed to load planning session: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to load session: {exc}")


@app.post("/rag/index")
async def rag_index(
    request: dict,
    x_user_id: Optional[str] = Header(None, alias="X-User-ID"),
):
    """Index a document from the device into the backend personal RAG store."""
    if not x_user_id:
        return JSONResponse({"error": "X-User-ID header is required"}, status_code=401)

    doc_id = request.get("id")
    source_type = request.get("source_type")
    content = request.get("content")
    metadata = request.get("metadata") or {}

    if not doc_id or not source_type or not content:
        return JSONResponse({"error": "id, source_type, and content are required"}, status_code=400)

    try:
        await container.knowledge.ainsert(
            name=doc_id,
            text_content=content,
            metadata={"user_id": x_user_id, "source_type": source_type, **metadata},
            upsert=True,
        )
        return {"ok": True}
    except Exception as e:
        logging.error("Failed to index document: %s", e, exc_info=True)
        return JSONResponse({"error": str(e)}, status_code=500)


# Sessions for OAuth state (required for request.session)
app.add_middleware(SessionMiddleware, secret_key=config.session_secret)

if __name__ == "__main__":
    agent_os.serve(
        app="app:app",
        reload=True,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", 7777)),
    )
