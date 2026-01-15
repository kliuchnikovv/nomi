import json
import logging
import os
import requests
from typing import Dict, Any, Optional, List

from fastapi import APIRouter, Request, Header, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import create_engine, text

from src.tools.task_manager import TaskManagementTool

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger(__name__)

db_dsn = os.getenv("DB_DSN")
if db_dsn and db_dsn.startswith("postgres://"):
    db_dsn = db_dsn.replace("postgres://", "postgresql://", 1)

engine = None
if db_dsn:
    try:
        engine = create_engine(db_dsn, pool_size=5, max_overflow=10)
    except Exception as e:
        logger.error(f"Failed to create DB engine: {e}")


class GithubWebhookPayload(BaseModel):
    action: str
    pr_number: int
    repository: str
    branch: str
    diff: str
    installation_id: int


class JulesWebhookPayload(BaseModel):
    event: str
    sessionId: str
    labels: Dict[str, str]
    artifacts: Optional[List[Dict[str, Any]]] = None
    error: Optional[str] = None


@router.post("/jules")
async def handle_jules_webhook(
    request: Request,
    x_jules_signature: Optional[str] = Header(None, alias="X-Jules-Signature")
):
    """
    Handles webhook events from Jules (the automated worker).
    Supports both raw JSON payload and structured JulesWebhookPayload.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    logger.info(f"[Webhook] Received Jules payload: {payload}")

    event_type = payload.get("type") or payload.get("event")
    session_id = payload.get("session_id") or payload.get("sessionId")

    task_id = None
    if "context" in payload:
        task_id = payload["context"].get("task_id")
    elif "labels" in payload:
        task_id = payload["labels"].get("task_id")

    if not task_id:
        logger.warning("[Webhook] No task_id found in Jules webhook payload.")
        return {"status": "ignored", "reason": "missing_task_id"}

    task_tool = TaskManagementTool()

    if event_type in ("PULL_REQUEST_CREATED", "SESSION_COMPLETED"):
        pr_url = None
        
        if "data" in payload:
            pr_url = payload["data"].get("pr_url")
        
        if not pr_url and "artifacts" in payload:
            for artifact in payload.get("artifacts", []):
                if artifact.get("type") == "pull_request" and "url" in artifact:
                    pr_url = artifact["url"]
                    break
                if "pullRequest" in artifact:
                    pr_url = artifact["pullRequest"].get("url")
                    break

        logger.info(f"[Webhook] Jules completed for Task {task_id}, PR: {pr_url}")

        if engine:
            try:
                with engine.connect() as conn:
                    jules_output = {
                        "pr_url": pr_url,
                        "session_id": session_id,
                    }

                    query = text("""
                        UPDATE project_tasks
                        SET
                            specs = COALESCE(specs::jsonb, '{}'::jsonb) || jsonb_build_object('jules_output', :jules_data),
                            updated_at = now()
                        WHERE id = :task_id
                    """)

                    conn.execute(query, {
                        "task_id": task_id,
                        "jules_data": json.dumps(jules_output)
                    })
                    conn.commit()

                    logger.info(f"Task {task_id} artifacts updated with PR {pr_url}")
            except Exception as e:
                logger.error(f"Failed to update task artifacts: {e}")

        result = task_tool.update_task_status(
            task_id=task_id,
            status="REVIEW",
            pr_url=pr_url
        )
        logger.info(f"Task status update result: {result}")

        return {"status": "processed", "task_id": task_id, "pr_url": pr_url}

    return {"status": "ignored", "event": event_type}


async def process_pr_review(payload: GithubWebhookPayload, internal_secret: str):
    """Background task to process PR review."""
    logger.info(f"Processing PR review for {payload.repository}#{payload.pr_number}")
    # TODO: Implement PR review logic using ReviewerAgent


@router.post("/github")
async def handle_github_webhook(
    payload: GithubWebhookPayload,
    background_tasks: BackgroundTasks,
    x_internal_secret: str = Header(None)
):
    """
    Handles GitHub webhook events proxied from Go backend.
    """
    internal_key = os.getenv("INTERNAL_API_KEY", "jules-secret-key")
    if x_internal_secret != internal_key:
        raise HTTPException(status_code=403, detail="Unauthorized")

    background_tasks.add_task(process_pr_review, payload, x_internal_secret)

    return {"status": "accepted", "message": "Review queued"}
