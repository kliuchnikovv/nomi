import os
import logging
import uuid
import inspect
from typing import Optional, Any
from pydantic import BaseModel

from agno.db.postgres import PostgresDb
from agno.os import AgentOS
from agno.models.google import Gemini
from starlette.middleware.sessions import SessionMiddleware

from src.agents.genie import GenieAgent
from src.server import ws as ws_server
from src.agents.factory import AgentFactory
from src.tools.config import ToolConfigClient
from src.tools.factory import ToolsConfig
from src.tools.client_side import start_action_tracking, get_client_actions

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
    # Fix for SQLAlchemy 2.0+: convert postgres:// to postgresql://
    # Railway's pgvector uses old format
    if db_dsn.startswith("postgres://"):
        db_dsn = db_dsn.replace("postgres://", "postgresql://", 1)
    db = PostgresDb(db_dsn)


tool_config_url = os.getenv("GO_API_URL", "http://localhost:8080")
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
    start_action_tracking()
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

    return {
        "answer": answer, 
        "reasoning": reasoning,
        "client_actions": [action.model_dump() for action in get_client_actions()]
    }

class BriefingRequest(BaseModel):
    user_id: Optional[str] = None
    context: Optional[dict] = None

@app.post("/api/briefing")
async def get_briefing(request: BriefingRequest):
    logging.info(f"Received briefing request. User: {request.user_id} Context provided: {bool(request.context)}")
    if request.context:
         logging.info(f"Context keys: {request.context.keys()}")
         if 'emails' in request.context:
             logging.info(f"Context email count: {len(request.context['emails'])}")
    
             logging.info(f"Context email count: {len(request.context['emails'])}")
    
    start_action_tracking()
    session_id = str(uuid.uuid4())
    # Build BriefingAgent
    agent = await agent_factory.build(
        session_id=session_id,
        user_id=request.user_id,
        agent_type="briefing",
    )
    
    # Construct prompt with context
    prompt = "Generate the morning briefing."
    
    context_has_data = False
    if request.context:
        for key, value in request.context.items():
            if value and isinstance(value, list) and len(value) > 0:
                context_has_data = True
                break
    
    if context_has_data:
        import json
        context_str = json.dumps(request.context, indent=2, default=str)
        prompt = f"""Generate the morning briefing based on the following context data from user integrations (TREAT THIS AS GATHERED DATA):

{context_str}

**IMPORTANT**: The data above comes from the user's local integrations (Gmail, etc.).
Even if you do not have active server-side tools, USE THIS DATA to generate the briefing.
Do NOT say 'connect integrations' if valid data is present in the context.
Analyze this data to identify critical items. Do not invent items not present in the data.
"""
    
    
    logging.info(f"Generated prompt (length: {len(prompt)}): {prompt[:200]}...")
    
    # 3. Run agent to get briefing
    try:
        logging.info("Running agent...")
        response = await agent.arun(prompt, stream=False)
        logging.info(f"Agent response type: {type(response)}")
        
        # Extract structured output
        if response and response.content:
            logging.info(f"Agent content (length: {len(response.content)}): {response.content[:200]}...")
            content = response.content
            # Handle string output (Agent returning JSON string)
            if isinstance(content, str):
                import json
                try:
                    # Strip markdown code blocks if present
                    clean_content = content.strip()
                    if clean_content.startswith("```json"):
                        clean_content = clean_content[7:]
                    elif clean_content.startswith("```"):
                        clean_content = clean_content[3:]
                    if clean_content.endswith("```"):
                        clean_content = clean_content[:-3]
                    clean_content = clean_content.strip()
                    
                    return json.loads(clean_content)
                except json.JSONDecodeError:
                    logging.error(f"Failed to parse JSON content: {content}")
                    return {"error": "Failed to parse briefing JSON", "raw_content": content}

            # Handle object output (if supported)
            if hasattr(content, "model_dump"):
                result = content.model_dump()
            else:
                 result = content
            
            # Attach client actions if result is a dict
            if isinstance(result, dict):
                result["client_actions"] = [action.model_dump() for action in get_client_actions()]
                
            return result
        
        return {"error": "No content generated"}
    except Exception as e:
        logging.error(f"Briefing generation failed: {e}", exc_info=True)
        return {"error": str(e)}

# ...
class AnalysisRequest(BaseModel):
    text: str

@app.post("/api/analyze")
async def analyze_text(request: AnalysisRequest):
    session_id = str(uuid.uuid4())
    agent = await agent_factory.build(
        session_id=session_id,
        agent_type="extraction"
    )
    
    prompt = f"Extract events and tasks from this text:\n\n{request.text}"
    
    try:
        response = await agent.arun(prompt, stream=False)
        if response and response.content:
            content = response.content
            # Handle object output
            if hasattr(content, "model_dump"):
                return content.model_dump()
            
            # Handle string output
            if isinstance(content, str):
                import json
                try:
                    clean_content = content.strip()
                    if clean_content.startswith("```json"):
                        clean_content = clean_content[7:]
                    elif clean_content.startswith("```"):
                        clean_content = clean_content[3:]
                    if clean_content.endswith("```"):
                        clean_content = clean_content[:-3]
                    return json.loads(clean_content.strip())
                except json.JSONDecodeError:
                    return {"events": [], "tasks": [], "error": "Failed to parse JSON"}
            
            return content
        return {"events": [], "tasks": []}
    except Exception as e:
        logging.error(f"Analysis failed: {e}", exc_info=True)
        return {"events": [], "tasks": [], "error": str(e)}


class EmailAnalysisRequest(BaseModel):
    email_id: str  # ID of the email for tracking
    subject: Optional[str] = None
    from_email: Optional[str] = None
    from_name: Optional[str] = None
    body: str  # Email body text
    date: Optional[str] = None


@app.post("/api/analyze-email")
async def analyze_email(request: EmailAnalysisRequest):
    """Analyze an email to extract urgency, connections, time frames, and suggest actions."""
    logging.info(f"Analyzing email: {request.email_id} subject='{request.subject}'")
    
    session_id = str(uuid.uuid4())
    agent = await agent_factory.build(
        session_id=session_id,
        agent_type="email_analyzer"
    )
    
    # Construct prompt with email details
    prompt = f"""Analyze the following email:

From: {request.from_name or 'Unknown'} <{request.from_email or 'unknown'}>
Subject: {request.subject or '(no subject)'}
Date: {request.date or 'Unknown'}

Body:
{request.body}

Extract urgency, connections, time frames, and suggest 2-5 actions."""
    
    try:
        response = await agent.arun(prompt, stream=False)
        if response and response.content:
            content = response.content
            
            # Handle object output
            if hasattr(content, "model_dump"):
                result = content.model_dump()
                result["email_id"] = request.email_id
                return result
            
            # Handle string output (JSON)
            if isinstance(content, str):
                import json
                try:
                    clean_content = content.strip()
                    if clean_content.startswith("```json"):
                        clean_content = clean_content[7:]
                    elif clean_content.startswith("```"):
                        clean_content = clean_content[3:]
                    if clean_content.endswith("```"):
                        clean_content = clean_content[:-3]
                    result = json.loads(clean_content.strip())
                    result["email_id"] = request.email_id
                    return result
                except json.JSONDecodeError:
                    logging.error(f"Failed to parse email analysis JSON: {content}")
                    return {
                        "email_id": request.email_id,
                        "urgency": "normal",
                        "connections": [],
                        "time_frame": None,
                        "suggested_actions": [],
                        "error": "Failed to parse JSON"
                    }
            
            return content
        
        return {
            "email_id": request.email_id,
            "urgency": "normal",
            "connections": [],
            "time_frame": None,
            "suggested_actions": []
        }
    except Exception as e:
        logging.error(f"Email analysis failed: {e}", exc_info=True)
        return {
            "email_id": request.email_id,
            "urgency": "normal",
            "connections": [],
            "time_frame": None,
            "suggested_actions": [],
            "error": str(e)
        }

# Sessions for OAuth state (required for request.session)
session_secret = os.getenv("SESSION_SECRET", "dev-session-secret-change-me")
app.add_middleware(SessionMiddleware, secret_key=session_secret)

try:
    app.include_router(ws_server.router(agent_factory))
    logging.info("WS route mounted at /llm/ws")
except Exception:
    logging.exception("Failed to mount WS routes")


class EmbeddingRequest(BaseModel):
    text: Optional[str] = None  # Single text (backward compatible)
    texts: Optional[list[str]] = None  # Batch of texts

@app.post("/api/embeddings")
async def get_embedding(request: EmbeddingRequest):
    """
    Generate embeddings for text(s).
    Transient processing: The text is NOT saved or logged.
    
    Accepts either:
    - `text`: Single string → returns `embedding`
    - `texts`: Array of strings → returns `embeddings`
    """
    try:
        # Batch mode
        if request.texts is not None:
            if len(request.texts) == 0:
                return {"embeddings": []}
            
            embeddings = []
            for text in request.texts:
                embedding = model.get_embedding(text)
                embeddings.append(embedding)
            return {"embeddings": embeddings}
        
        # Single mode (backward compatible)
        if request.text is not None:
            embedding = model.get_embedding(request.text)
            return {"embedding": embedding}
        
        return {"error": "Either 'text' or 'texts' must be provided"}
    except Exception as e:
        logging.error(f"Embedding generation failed: {e}")
        return {"error": str(e)}

if __name__ == "__main__":
    agent_os.serve(
        app="app:app", 
        reload=True,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", 7777)),
    )
