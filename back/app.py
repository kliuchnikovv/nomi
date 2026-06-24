import base64
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

from src.agents.nomi import NomiAgent

from dotenv import load_dotenv
from src.core.config import Config
from src.core.container import Container
from src.plugins.loader import load_plugins, register_plugin_routes
from src.commands import load_commands
from src.commands.registry import CommandRegistry
from src.tools.config import ToolConfigClient

# Load environment variables from .env file if it exists
# If file not found, use system environment variables (for production)
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
    logging.getLogger("websockets").setLevel(logging.WARNING)

    logging.info("Logging initialized at %s", level_name)


_init_logging()

logging.warning("[Startup] Python service initializing...")

# Initialize configuration and container
try:
    logging.warning("[Startup] Loading config...")
    config = Config.from_env()
    logging.warning("[Startup] Config loaded: debug=%s", config.debug_mode)
except Exception as e:
    logging.critical("[Startup] FAILED to load config: %s", e, exc_info=True)
    raise

try:
    logging.warning("[Startup] Creating container...")
    container = Container(config=config)
    logging.warning("[Startup] Container created")
except Exception as e:
    logging.critical("[Startup] FAILED to create container: %s", e, exc_info=True)
    raise

# Initialize AgentOS for compatibility with existing code
try:
    logging.warning("[Startup] Creating NomiAgent...")
    nomi = NomiAgent(
        db=container.db,
        model=container.model,
        debug_mode=config.debug_mode,
    )
    logging.warning("[Startup] NomiAgent created")
    logging.warning("[Startup] Creating AgentOS app...")
    agent_os = AgentOS(agents=[nomi])
    global app
    app = agent_os.get_app()
    logging.warning("[Startup] AgentOS app created")
except Exception as e:
    logging.critical("[Startup] FAILED to create AgentOS/NomiAgent: %s", e, exc_info=True)
    raise

# Initialize ToolConfigClient singleton for GET /commands endpoint
# Points to Go API at localhost:8000 by default; override with GENIE_API_BASE_URL env var
_tool_config_client = ToolConfigClient(
    base_url=os.getenv("GENIE_API_BASE_URL", "http://localhost:8000")
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logging.warning("[Lifespan] Starting up...")

    logging.warning("[Lifespan] Loading plugins...")
    startup_hooks = []
    try:
        load_plugins()
        startup_hooks = register_plugin_routes(app)
        logging.warning("[Lifespan] Plugins loaded and routes registered successfully")
    except Exception as e:
        logging.error("[Lifespan] Failed to load plugins: %s", e, exc_info=True)

    for hook in startup_hooks:
        try:
            logging.warning("[Lifespan] Running startup hook: %s", hook.__name__)
            await hook()
            logging.warning("[Lifespan] Startup hook done: %s", hook.__name__)
        except Exception as e:
            logging.error("[Lifespan] Plugin startup hook %s failed: %s", hook.__name__, e, exc_info=True)

    # Start direct Go WebSocket connection (eliminates Redis RTT for response frames).
    go_ws = None
    try:
        from src.server.go_ws_client import GoWSClient
        go_ws = GoWSClient()
        await go_ws.connect()
        container.set_go_ws(go_ws)
        logging.warning("[Lifespan] GoWSClient connected to Go API")
    except Exception as e:
        logging.warning("[Lifespan] GoWSClient unavailable, using Redis fallback: %s", e)

    logging.warning("[Lifespan] Initializing Redis Worker...")
    try:
        redis_worker = container.redis_worker
        await redis_worker.start()
        logging.warning("[Lifespan] Redis Worker started successfully")
    except Exception as e:
        logging.error("[Lifespan] Failed to start Redis Worker: %s", e, exc_info=True)

    logging.warning("[Lifespan] Initializing Judge Worker...")
    try:
        from src.proactive.judge_worker import JudgeWorker
        judge_worker = JudgeWorker()
        await judge_worker.start()
        logging.warning("[Lifespan] Judge Worker started successfully")
    except Exception as e:
        logging.error("[Lifespan] Failed to start Judge Worker: %s", e, exc_info=True)

    logging.warning("[Lifespan] Startup complete — ready to serve requests")
    yield

    # Shutdown
    logging.warning("[Lifespan] Shutting down resources...")
    if go_ws:
        await go_ws.close()
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


@app.get("/commands")
async def list_commands(x_user_id: str = Header(..., alias="X-User-ID")):
    """Return per-user command listing with missing integrations computed.

    Uses the user's connected integrations (fetched via ToolConfigClient)
    to determine which integrations each command requires but the user hasn't connected.
    """
    load_commands()
    cfg = await _tool_config_client.fetch_tools(user_id=x_user_id)
    connected = set(cfg.entries.keys()) if cfg and getattr(cfg, "entries", None) else set()

    def missing_resolver(requires):
        """Return list of integrations required by a command that aren't connected."""
        return [r for r in requires if r not in connected]

    listing = CommandRegistry.public_listing(missing_resolver)
    for entry in listing:
        # Tag existing entries so the client can route picks correctly.
        # Agent commands dispatch through op=command_call (with args form).
        entry.setdefault("kind", "agent")

    # Append power-user slash commands. Marked kind=slash so the client sends
    # them as a plain text message — the bridge to redis_session.handle_user_message
    # which parses the leading "/" and dispatches to slash_commands.dispatch.
    from src.server.slash_commands.registry import all_commands as _slash_all

    for spec in _slash_all():
        listing.append(
            {
                "name": spec.name,
                "title": f"/{spec.name}",
                "description": spec.summary,
                "requires": [],
                "missing": [],
                "args_schema": {},
                "surface": "chat",
                "kind": "slash",
            }
        )
    return {"commands": listing}


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


def _parse_document(file_type: str, raw: bytes) -> str:
    """Extract plain text from a project document. Supports text/markdown/pdf."""
    ft = (file_type or "").lower()
    if "pdf" in ft:
        import io as _io

        from pypdf import PdfReader

        reader = PdfReader(_io.BytesIO(raw))
        parts = []
        for page in reader.pages:
            try:
                parts.append(page.extract_text() or "")
            except Exception:
                continue
        return "\n".join(parts)
    # text/plain, text/markdown (and any other text-ish type)
    return raw.decode("utf-8", errors="replace")


def _chunk_text(text: str, size: int = 1000, overlap: int = 200) -> list[str]:
    """Split text into overlapping chunks for embedding."""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= size:
        return [text]
    chunks: list[str] = []
    start = 0
    step = max(1, size - overlap)
    while start < len(text):
        chunks.append(text[start : start + size])
        start += step
    return chunks


@app.post("/rag/index_document")
async def rag_index_document(request: dict):
    """Parse, chunk and embed a project document into the vector store, scoped by
    project_id. Called by the Go API after a file is uploaded to a project."""
    import base64

    document_id = request.get("document_id")
    project_id = request.get("project_id")
    user_id = request.get("user_id")
    file_name = request.get("file_name") or ""
    file_type = request.get("file_type") or ""
    content_b64 = request.get("content_b64")

    if not document_id or not project_id or not user_id or not content_b64:
        return JSONResponse(
            {"error": "document_id, project_id, user_id and content_b64 are required"},
            status_code=400,
        )

    try:
        raw = base64.b64decode(content_b64)
        text = _parse_document(file_type, raw)
        chunks = _chunk_text(text)
        if not chunks:
            return JSONResponse(
                {"error": "no extractable text in document"}, status_code=400
            )

        for i, chunk in enumerate(chunks):
            await container.knowledge.ainsert(
                name=f"{document_id}:{i}",
                text_content=chunk,
                metadata={
                    "user_id": str(user_id),
                    "project_id": str(project_id),
                    "source": "project_document",
                    "document_id": str(document_id),
                    "file_name": file_name,
                    "chunk_index": i,
                },
                upsert=True,
            )
        return {"chunk_count": len(chunks)}
    except Exception as e:
        logging.error("Failed to index project document: %s", e, exc_info=True)
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/rag/remove")
async def rag_remove(request: dict):
    """Remove all vectors for a project document by metadata. Called by the Go API
    when a project document is deleted."""
    user_id = request.get("user_id")
    project_id = request.get("project_id")
    document_id = request.get("document_id")

    if not document_id or not user_id:
        return JSONResponse(
            {"error": "user_id and document_id are required"}, status_code=400
        )

    try:
        metadata = {"user_id": str(user_id), "document_id": str(document_id)}
        if project_id:
            metadata["project_id"] = str(project_id)
        ok = container.knowledge.remove_vectors_by_metadata(metadata)
        return {"ok": bool(ok)}
    except Exception as e:
        logging.error("Failed to remove project document vectors: %s", e, exc_info=True)
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/voice/tts")
async def voice_tts(
    request: dict,
    x_user_id: Optional[str] = Header(None, alias="X-User-ID"),
):
    """Synthesize assistant reply text to speech (experimental server voice
    source). Provider is set by VOICE_TTS_PROVIDER (edge=MP3 default, gemini=WAV).
    Returns base64 audio + mime + duration_ms."""
    if not x_user_id:
        return JSONResponse({"error": "X-User-ID header is required"}, status_code=401)

    text = (request.get("text") or "").strip()
    if not text:
        return JSONResponse({"error": "text is required"}, status_code=400)
    voice = request.get("voice")

    try:
        from src.core.tts import synthesize

        res = await synthesize(text, voice)
        return {
            "audio": base64.b64encode(res.audio).decode("ascii"),
            "mime": res.mime,
            "duration_ms": res.duration_ms,
        }
    except Exception as e:
        logging.error("Voice TTS failed: %s", e, exc_info=True)
        return JSONResponse({"error": str(e)}, status_code=500)


# Sessions for OAuth state (required for request.session)
app.add_middleware(SessionMiddleware, secret_key=config.session_secret)

if __name__ == "__main__":
    _port = int(os.getenv("PORT", 7777))
    logging.warning("[Startup] Listening on port %d", _port)
    agent_os.serve(
        app="app:app",
        reload=True,
        host=os.getenv("HOST", "0.0.0.0"),
        port=_port,
    )
