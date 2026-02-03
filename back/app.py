import os
import logging
from contextlib import asynccontextmanager
from typing import Optional, Any

from fastapi import FastAPI
from pydantic import BaseModel

from agno.os import AgentOS
from starlette.middleware.sessions import SessionMiddleware

from src.agents.souper import SouperAgent

from dotenv import load_dotenv
from src.core.config import Config
from src.core.container import Container

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
        from src.plugins.loader import load_plugins

        load_plugins()
        logging.warning("[Lifespan] Plugins loaded successfully")
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


# Sessions for OAuth state (required for request.session)
app.add_middleware(SessionMiddleware, secret_key=config.session_secret)

if __name__ == "__main__":
    agent_os.serve(
        app="app:app",
        reload=True,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", 7777)),
    )
