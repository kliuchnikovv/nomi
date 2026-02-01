import os
import logging
import uuid
import inspect
from contextlib import asynccontextmanager
from typing import Optional, Any

from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel

from agno.os import AgentOS
from starlette.middleware.sessions import SessionMiddleware

from src.agents.souper import SouperAgent
# from src.agents.genie import GenieAgent
from src.server import webhooks
from src.tools.client_side import start_action_tracking, get_client_actions
# from src.teams.development.team import (
#     DevelopmentTeam,
# )  # Import for type hinting if needed, or dynamic loading

from dotenv import load_dotenv
from src.core.config import Config
from src.core.container import Container
from src.knowledge.factory import build_vector_db

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
    # workflows=[
    #     DevelopmentTeam(
    #         model=container.model,
    #         db=container.db,
    #         debug_mode=config.debug_mode,
    #         github_token=os.getenv("GITHUB_TOKEN"),
    #     )
    # ],
)
global app
app = agent_os.get_app()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("[Lifespan] Starting up...")

    # Initialize global Vector DB
    global global_vector_db
    try:
        logging.info("[Lifespan] Initializing global Vector DB...")
        global_vector_db = build_vector_db()
        logging.info("[Lifespan] Global Vector DB initialized successfully")
    except Exception as e:
        logging.error(
            f"[Lifespan] Failed to initialize global Vector DB: {e}", exc_info=True
        )
        # We don't raise here to allow app to start without RAG if DB is down,
        # but RAG endpoints will fail gracefully.

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


class QueryRequest(BaseModel):
    query: str


@app.post("/query")
async def run_query(request: QueryRequest):
    start_action_tracking()
    session_id = str(uuid.uuid4())
    # Используем agent_factory из container
    agent = await container.agent_factory.build(session_id=session_id)

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
        "client_actions": [action.model_dump() for action in get_client_actions()],
    }


class BriefingRequest(BaseModel):
    user_id: Optional[str] = None
    context: Optional[dict] = None


@app.post("/api/briefing")
async def get_briefing(request: BriefingRequest):
    logging.info(
        f"Received briefing request. User: {request.user_id} Context provided: {bool(request.context)}"
    )
    if request.context:
        logging.info(f"Context keys: {request.context.keys()}")
        if "emails" in request.context:
            logging.info(f"Context email count: {len(request.context['emails'])}")

            logging.info(f"Context email count: {len(request.context['emails'])}")

    start_action_tracking()
    session_id = str(uuid.uuid4())
    # Build BriefingAgent используя container
    agent = await container.agent_factory.build(
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
            logging.info(
                f"Agent content (length: {len(response.content)}): {response.content[:200]}..."
            )
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
                    return {
                        "error": "Failed to parse briefing JSON",
                        "raw_content": content,
                    }

            # Handle object output (if supported)
            if hasattr(content, "model_dump"):
                result = content.model_dump()
            else:
                result = content

            # Attach client actions if result is a dict
            if isinstance(result, dict):
                result["client_actions"] = [
                    action.model_dump() for action in get_client_actions()
                ]

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
    agent = await container.agent_factory.build(
        session_id=session_id, agent_type="extraction"
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


class StoreFactsRequest(BaseModel):
    """Request to store client-extracted facts into user's knowledge base."""

    user_id: str
    extracted_facts: list[str]


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
    agent = await container.agent_factory.build(
        session_id=session_id, agent_type="email_analyzer"
    )

    # Construct prompt with email details
    prompt = f"""Analyze the following email:

From: {request.from_name or "Unknown"} <{request.from_email or "unknown"}>
Subject: {request.subject or "(no subject)"}
Date: {request.date or "Unknown"}

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
                        "error": "Failed to parse JSON",
                    }

            return content

        return {
            "email_id": request.email_id,
            "urgency": "normal",
            "connections": [],
            "time_frame": None,
            "suggested_actions": [],
        }
    except Exception as e:
        logging.error(f"Email analysis failed: {e}", exc_info=True)
        return {
            "email_id": request.email_id,
            "urgency": "normal",
            "connections": [],
            "time_frame": None,
            "suggested_actions": [],
            "error": str(e),
        }


@app.post("/api/store-facts")
async def store_facts(request: StoreFactsRequest):
    """
    Store client-extracted facts into user's knowledge base.
    Called by Go backend when client sends store_facts via WebSocket.
    HTTP is used instead of Redis pub/sub for reliability.
    """
    if not request.user_id or not request.extracted_facts:
        return {"status": "skipped", "reason": "missing user_id or facts"}
    knowledge = container.agent_factory.get_knowledge()
    if not knowledge:
        logging.warning(
            "[store-facts] get_knowledge returned None for user=%s",
            request.user_id,
        )
        return {"status": "error", "reason": "knowledge base unavailable"}
    stored = 0
    for fact in request.extracted_facts:
        if isinstance(fact, str) and fact.strip():
            try:
                knowledge.insert(
                    text_content=fact.strip(),
                    metadata={"user_id": request.user_id},
                )
                stored += 1
            except Exception as e:
                logging.warning("[store-facts] Failed to store fact: %s", e)
    logging.info("[store-facts] Stored %d fact(s) for user=%s", stored, request.user_id)
    return {"status": "ok", "stored": stored}


# Sessions for OAuth state (required for request.session)
app.add_middleware(SessionMiddleware, secret_key=config.session_secret)

try:
    app.include_router(webhooks.router)
    logging.info("Webhooks route mounted at /webhooks")
except Exception:
    logging.exception("Failed to mount Webhooks routes")


class RepoListRequest(BaseModel):
    github_token: Optional[str] = None


@app.post("/api/github/repos")
async def list_github_repos(request: RepoListRequest):
    """List repositories for the authenticated user."""
    from github import Github
    import asyncio

    token = request.github_token or os.environ.get("GITHUB_TOKEN")
    if not token:
        return {"error": "No GitHub token provided"}

    def fetch_repos():
        g = Github(token)
        user = g.get_user()
        repos = []
        # sort by updated to show most relevant first
        for repo in user.get_repos(sort="updated", direction="desc"):
            repos.append(
                {
                    "id": repo.id,
                    "name": repo.full_name,  # owner/repo
                    "private": repo.private,
                    "url": repo.html_url,
                    "description": repo.description,
                }
            )
            if len(repos) >= 50:  # Limit to 50 recent repos to avoid slow response
                break
        return repos

    try:
        repos = await asyncio.to_thread(fetch_repos)
        return {"repos": repos}
    except Exception as e:
        logging.error(f"Failed to fetch GitHub repos: {e}")
        return {"error": str(e), "repos": []}


class ProjectAnalysisRequest(BaseModel):
    project_id: str
    repository: str
    github_token: Optional[str] = None
    user_id: Optional[str] = None  # Owner of the project


@app.post("/api/analyze-project")
async def analyze_project(request: ProjectAnalysisRequest):
    """
    Trigger repository analysis and indexing for a project.
    This endpoint is called by Go backend when a project with repository is created.
    """
    import asyncio
    import requests

    logging.info(
        f"Received project analysis request: {request.project_id} repo={request.repository}"
    )

    def update_status(status: str):
        api_url = os.getenv("GO_API_URL", "http://localhost:8080")
        if not api_url.endswith("/api"):
            api_url = f"{api_url}/api"
        url = f"{api_url}/projects/{request.project_id}/status"
        headers = {}
        internal_key = os.getenv("INTERNAL_API_KEY", "jules-secret-key")
        headers["X-Internal-Secret"] = internal_key
        try:
            resp = requests.patch(url, json={"status": status}, headers=headers)
            logging.info(
                f"Updated project {request.project_id} status to {status}, response: {resp.status_code}"
            )
        except Exception as e:
            logging.error(f"Failed to update project status: {e}")

    async def run_analysis():
        try:
            from src.rag_service import ProjectKnowledgeManager

            # Use github token from request or fallback to env (optional for public repos)
            github_token = request.github_token or os.environ.get("GITHUB_TOKEN")
            # Token is now optional - public repos work without it (with rate limits)

            manager = ProjectKnowledgeManager(
                user_id=request.user_id or "system",
                knowledge=container.agent_factory.get_knowledge(),
                vector_db=global_vector_db,
            )
            await asyncio.to_thread(
                manager.ingest_repository,
                request.repository,
                request.project_id,
                github_token,  # Can be None for public repos
            )

            logging.info(f"Completed analysis for project {request.project_id}")
            await asyncio.to_thread(update_status, "READY")

        except Exception as e:
            logging.error(
                f"Failed to analyze project {request.project_id}: {e}", exc_info=True
            )
            await asyncio.to_thread(update_status, "FAILED")

    # Run analysis in background
    asyncio.create_task(run_analysis())

    return {"status": "started", "project_id": request.project_id}


class DeleteProjectRequest(BaseModel):
    user_id: Optional[str] = None


@app.delete("/api/projects/{project_id}")
async def delete_project_knowledge_endpoint(
    project_id: str, request: Optional[DeleteProjectRequest] = None
):
    """
    Delete RAG knowledge for a project.
    """
    import asyncio

    try:
        from src.rag_service import ProjectKnowledgeManager

        user_id = request.user_id if request else None
        logging.info(
            f"Received request to delete knowledge for project {project_id} (user: {user_id})"
        )

        manager = ProjectKnowledgeManager(
            user_id=user_id or "system",
            knowledge=container.agent_factory.get_knowledge(),
            vector_db=global_vector_db,
        )
        await asyncio.to_thread(manager.delete_project_knowledge, project_id)

        return {"status": "deleted", "project_id": project_id}
    except Exception as e:
        logging.error(f"Failed to delete project knowledge: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class ReindexProjectRequest(BaseModel):
    repository: str
    github_token: Optional[str] = None
    user_id: Optional[str] = None  # Owner of the project


@app.post("/api/projects/{project_id}/reindex")
async def reindex_project(project_id: str, request: ReindexProjectRequest):
    """
    Re-index project: delete old RAG knowledge and re-ingest from repository.
    Called when user wants to refresh project knowledge.
    """
    import asyncio
    import requests

    logging.info(
        f"Received reindex request: project={project_id} repo={request.repository}"
    )

    def update_status(status: str):
        api_url = os.getenv("GO_API_URL", "http://localhost:8080")
        if not api_url.endswith("/api"):
            api_url = f"{api_url}/api"
        url = f"{api_url}/projects/{project_id}/status"
        headers = {}
        internal_key = os.getenv("INTERNAL_API_KEY", "jules-secret-key")
        headers["X-Internal-Secret"] = internal_key
        try:
            resp = requests.patch(url, json={"status": status}, headers=headers)
            logging.info(
                f"Updated project {project_id} status to {status}, response: {resp.status_code}"
            )
        except Exception as e:
            logging.error(f"Failed to update project status: {e}")

    async def run_reindex():
        try:
            from src.rag_service import ProjectKnowledgeManager

            github_token = request.github_token or os.environ.get("GITHUB_TOKEN")

            manager = ProjectKnowledgeManager(
                user_id=request.user_id or "system",
                knowledge=container.agent_factory.get_knowledge(),
                vector_db=global_vector_db,
            )
            await asyncio.to_thread(
                manager.reindex_repository, request.repository, project_id, github_token
            )

            logging.info(f"Completed reindex for project {project_id}")
            await asyncio.to_thread(update_status, "READY")

        except Exception as e:
            logging.error(f"Failed to reindex project {project_id}: {e}", exc_info=True)
            await asyncio.to_thread(update_status, "FAILED")

    # Run reindex in background
    asyncio.create_task(run_reindex())

    return {"status": "started", "project_id": project_id}


# --- Lists RAG ---


class IndexListItemRequest(BaseModel):
    content: str
    title: Optional[str] = None
    url: Optional[str] = None
    user_id: Optional[str] = None
    item_id: Optional[str] = None  # For deduplication


@app.post("/api/lists/{list_id}/items/index")
async def index_list_item(list_id: str, request: IndexListItemRequest):
    """
    Add one document to a list's RAG space (metadata: user_id, list_id).
    Called by Go API after creating/updating a list item.
    """
    import asyncio

    try:
        from src.rag_service import ProjectKnowledgeManager

        user_id = request.user_id or "system"
        parts = []
        if request.title:
            parts.append(request.title)
        if request.url:
            parts.append(request.url)
        parts.append(request.content)
        content = "\n".join(parts)

        manager = ProjectKnowledgeManager(
            user_id=user_id,
            knowledge=container.agent_factory.get_knowledge(),
            vector_db=global_vector_db,
        )
        await asyncio.to_thread(
            manager.add_document,
            content,
            project_id=None,
            list_id=list_id,
            item_id=request.item_id,
        )

        return {"status": "indexed", "list_id": list_id}
    except Exception as e:
        logging.error(f"Failed to index list item: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class DeleteListKnowledgeRequest(BaseModel):
    user_id: Optional[str] = None


@app.delete("/api/lists/{list_id}/knowledge")
async def delete_list_knowledge_endpoint(
    list_id: str, request: Optional[DeleteListKnowledgeRequest] = None
):
    """
    Delete all RAG knowledge for a list. Called by Go API when list is deleted.
    """
    import asyncio

    try:
        from src.rag_service import ProjectKnowledgeManager

        user_id = request.user_id if request else None
        logging.info(
            f"Received request to delete knowledge for list {list_id} (user: {user_id})"
        )

        manager = ProjectKnowledgeManager(
            user_id=user_id or "system",
            knowledge=container.agent_factory.get_knowledge(),
            vector_db=global_vector_db,
        )
        await asyncio.to_thread(manager.delete_list_knowledge, list_id)

        return {"status": "deleted", "list_id": list_id}
    except Exception as e:
        logging.error(f"Failed to delete list knowledge: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class EmbeddingRequest(BaseModel):
    text: Optional[str] = None  # Single text (backward compatible)
    texts: Optional[list[str]] = None  # Batch of texts


@app.post("/api/embeddings")
async def get_embedding(
    request: EmbeddingRequest,
    x_internal_secret: Optional[str] = Header(None, alias="X-Internal-Secret"),
):
    """
    Generate embeddings for text(s).
    Transient processing: The text is NOT saved or logged.
    Requires internal authentication.

    Accepts either:
    - `text`: Single string → returns `embedding`
    - `texts`: Array of strings → returns `embeddings`
    """
    # Verify internal secret
    internal_key = os.getenv("INTERNAL_API_KEY", "jules-secret-key")
    if x_internal_secret != internal_key:
        raise HTTPException(status_code=403, detail="Unauthorized")

    try:
        # Batch mode
        if request.texts is not None:
            if len(request.texts) == 0:
                return {"embeddings": []}

            # Use native batch embedding for efficiency
            (
                embeddings,
                _,
            ) = await container.embedder.async_get_embeddings_batch_and_usage(
                request.texts
            )
            return {"embeddings": embeddings}

        # Single mode (backward compatible)
        if request.text is not None:
            embedding = await container.embedder.async_get_embedding(request.text)
            return {"embedding": embedding}

        raise HTTPException(
            status_code=400, detail="Either 'text' or 'texts' must be provided"
        )
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Embedding generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    agent_os.serve(
        app="app:app",
        reload=True,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", 7777)),
    )
