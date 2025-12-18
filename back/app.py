import os
import logging

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
def _init_logging():
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    root = logging.getLogger()
    root.setLevel(level)
    if not root.handlers:
        h = logging.StreamHandler()
        fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s - %(message)s")
        h.setFormatter(fmt)
        root.addHandler(h)
    logging.getLogger("agno").setLevel(level)
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
