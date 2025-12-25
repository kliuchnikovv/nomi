import os
import logging
import uuid
import inspect
from pydantic import BaseModel

from agno.db.postgres import PostgresDb
from agno.os import AgentOS
from agno.models.google import Gemini
from starlette.middleware.sessions import SessionMiddleware

from src.agents.genie import GenieAgent
from src.server import ws as ws_server
from src.agents.factory import AgentFactory
from src.tools.config import ToolConfigClient

from dotenv import load_dotenv

# Загружаем переменные окружения из .env файла, если он существует
# Если файл не найден, используем переменные окружения из системы (для продакшн)
load_dotenv()

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
        
        # Clean message without timestamp and level
        message = record.getMessage()
        
        # Build Railway-compatible JSON structure
        log_entry = {
            "message": message,
            "attributes": {
                "level": self.LEVEL_MAP.get(record.levelno, "info"),
            },
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
        
        # Add logger name if not root
        if record.name and record.name != "root":
            log_entry["attributes"]["logger"] = record.name
        
        # Add exception info if present
        if record.exc_info:
            log_entry["attributes"]["exception"] = self.formatException(record.exc_info)
        
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
        log.propagate = True # Let it bubble up to root (which has our JSON formatter)
        log.setLevel(logging.WARNING)

    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("hpack").setLevel(logging.WARNING)
    
    logging.info("Logging initialized at %s", level_name)

debug_mode = os.getenv("DEBUG") == "True"
_init_logging()

model=Gemini(
    id="gemini-2.0-flash",
    api_key=os.getenv("GOOGLE_API_KEY"),
)

db: PostgresDb | None = None
db_dsn = os.getenv("DB_DSN")
if db_dsn:
    db = PostgresDb(db_dsn)

tool_config_url = os.getenv("TOOL_CONFIG_URL", "http://localhost:8080")
tool_config_client = ToolConfigClient(tool_config_url)
agent_factory = AgentFactory(
    db=db,
    model=model,
    config_client=tool_config_client,
    debug_mode=debug_mode,
)

result = tool_config_client.fetch_tools("00000000-0000-0000-0000-000000000000")

agent_os = AgentOS(
    agents=[GenieAgent(
        db=db,
        model=model,
        debug_mode=debug_mode,
    )]
)
global app
app = agent_os.get_app()

@app.on_event("shutdown")
async def _shutdown_tool_config_client():
    await tool_config_client.close()

# Health check endpoint for Railway zero-downtime deployments
@app.get("/health")
async def health_check():
    from datetime import datetime
    return {"status": "ok", "time": datetime.utcnow().isoformat()}

class QueryRequest(BaseModel):
    query: str

@app.post("/query")
async def run_query(request: QueryRequest):
    session_id = str(uuid.uuid4())
    # AgentFactory is already configured
    agent = await agent_factory.build(session_id=session_id)
    
    # Run agent non-streaming
    # arun might be a coroutine function or a regular function returning a coroutine/generator
    # We force stream=False to get a RunResponse object instead of generator
    response_or_coro = agent.arun(request.query, stream=False)
    
    if inspect.isawaitable(response_or_coro):
        response = await response_or_coro
    else:
        response = response_or_coro
    
    # Extract content
    # response should be RunResponse
    answer = ""
    reasoning = None

    if hasattr(response, "content") and response.content:
        answer = str(response.content)
    elif response and isinstance(response, str):
         answer = response
         
    # Extract reasoning
    if hasattr(response, "reasoning_content") and response.reasoning_content:
        reasoning = str(response.reasoning_content)
    elif hasattr(response, "reasoning_steps") and response.reasoning_steps:
         reasoning = "\n".join([str(step) for step in response.reasoning_steps])

    return {"answer": answer, "reasoning": reasoning}

# Sessions for OAuth state (required for request.session)
session_secret = os.getenv("SESSION_SECRET", "dev-session-secret-change-me")
app.add_middleware(SessionMiddleware, secret_key=session_secret)

try:
    app.include_router(ws_server.router(agent_factory))
    logging.info("WS route mounted at /llm/ws")
except Exception:
    logging.exception("Failed to mount WS routes")

if __name__ == "__main__":
    agent_os.serve(
        app="app:app", 
        reload=True,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", 7777)),
    )
