import os
import logging

from agno.os import AgentOS
from agno.models.google import Gemini
from agno.tools.googlecalendar import GoogleCalendarTools
from agno.tools.gmail import GmailTools
from google.oauth2.credentials import Credentials

from src.internal.store.token import make_engine, TokenStorePG
from src.internal.store.remote_token import TokenStoreRemote
from src.teams.genie.agent import GenieAgent
# gRPC message processor is deprecated in favor of WS; not mounted
from src.server import sse as sse_server
from src.server import ws as ws_server

from dotenv import load_dotenv

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

_init_logging()
from starlette.middleware.sessions import SessionMiddleware

debug_mode = True

engine = make_engine("postgresql+asyncpg://postgres:postgres@localhost:5432/postgres")
db = None  # Using SQLAlchemy engine directly; agent DB not required here

oauth_service_url = os.getenv("OAUTH_SERVICE_URL")
if oauth_service_url:
    token_store = TokenStoreRemote(oauth_service_url)
else:
    token_store = TokenStorePG(engine)

model=Gemini(
    id="gemini-2.0-flash",
    api_key=os.getenv("GOOGLE_API_KEY"),
)

agent = GenieAgent(
    db=db,
    model=model,
    tools=[
        GmailTools(
            creds=Credentials(
                token="",

            ),
            credentials_path="./client_creds.json", port=8080,
        ),
        GoogleCalendarTools(credentials_path="./client_creds.json", oauth_port=8080),
    ],
    debug_mode=debug_mode,
)

agent_os = AgentOS(
    agents=[
        agent,
    ],
)
app = agent_os.get_app()

# Sessions for OAuth state (required for request.session)
session_secret = os.getenv("SESSION_SECRET") or "dev-session-secret-change-me"
app.add_middleware(SessionMiddleware, secret_key=session_secret)

# Routes: SSE streaming endpoint
try:
    app.include_router(sse_server.router(agent))
    logging.info("SSE routes mounted at /llm/stream")
except Exception:
    logging.exception("Failed to mount SSE routes")

try:
    app.include_router(ws_server.router(agent))
    logging.info("WS route mounted at /llm/ws")
except Exception:
    logging.exception("Failed to mount WS routes")

# No lifespan hooks required now that gRPC is disabled

if __name__ == "__main__":
    agent_os.serve(app="app:app", reload=True)
