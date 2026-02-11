import os
import logging
from contextlib import asynccontextmanager
from typing import Optional, Any

from fastapi import FastAPI

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


# Embeddings endpoint for local RAG
@app.post("/embeddings")
async def generate_embeddings(request: dict):
    """
    Generate embeddings for text using Gemini embedding model.
    Used by frontend's local RAG store for on-device semantic search.
    """
    from typing import List

    # Handle both single text and batch texts
    if "text" in request:
        texts = [request["text"]]
    elif "texts" in request:
        texts = request["texts"]
    else:
        return {"error": "Missing 'text' or 'texts' in request body"}, 400

    if not texts or len(texts) == 0:
        return {"error": "No texts provided"}, 400

    try:
        # Get embedder from container
        embedder = container.embedder

        # Generate embeddings
        embeddings: List[List[float]] = []
        for text in texts:
            embedding = embedder.get_embedding(text)
            embeddings.append(embedding)

        # Return appropriate response format
        if "text" in request:
            return {"embedding": embeddings[0]}
        else:
            return {"embeddings": embeddings}
    except Exception as e:
        logging.error("Failed to generate embeddings: %s", e, exc_info=True)
        return {"error": str(e)}, 500


# Sessions for OAuth state (required for request.session)
app.add_middleware(SessionMiddleware, secret_key=config.session_secret)

if __name__ == "__main__":
    agent_os.serve(
        app="app:app",
        reload=True,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", 7777)),
    )
