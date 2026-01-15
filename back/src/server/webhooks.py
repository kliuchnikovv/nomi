import logging
import os
from typing import Dict, Any, Optional

from fastapi import APIRouter, Request, Header, HTTPException
from src.tools.task_manager import TaskManagementTool

# Create router for webhooks
router = APIRouter(prefix="/webhooks", tags=["webhooks"])

@router.post("/jules")
async def handle_jules_webhook(
    request: Request,
    x_jules_signature: Optional[str] = Header(None, alias="X-Jules-Signature")
):
    """
    Handles webhook events from Jules (the automated worker).
    Expected payload includes session status, PR created event, or errors.
    """
    try:
        payload = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    logging.info(f"[Webhook] Received Jules payload: {payload}")

    # Validate signature if needed (skipped for now as per internal proxy trust)
    
    event_type = payload.get("type")
    session_id = payload.get("session_id")

    # We might need task_id from payload context or metadata
    # Assuming Jules returns the metadata we passed or we can infer it
    # If not, we might need to store session_id <-> task_id mapping in Redis/DB
    # For now, let's assume payload contains `clientContext` or similar with task_id

    # Example payload structure (hypothetical based on typical webhook)
    # {
    #   "type": "PULL_REQUEST_CREATED",
    #   "session_id": "...",
    #   "data": { "pr_url": "..." },
    #   "context": { "task_id": "..." }
    # }

    # Check context for task_id
    context = payload.get("context", {})
    task_id = context.get("task_id")

    # If task_id not in context, try to find it via session_id in our storage?
    # Since we don't have easy reverse lookup without DB query, we hope it's passed back.
    # If Jules doesn't support passing context back, we rely on the generic 'wait_for_pr' polling (fallback)
    # OR we implement the Redis mapping in DevelopmentTeam.start_jules.

    if not task_id:
        logging.warning("[Webhook] No task_id found in Jules webhook payload.")
        # Proceed only if we can identify what to do
        # For PULL_REQUEST_CREATED, we might try to match branch name in payload if present?
        return {"status": "ignored", "reason": "missing_task_id"}

    task_tool = TaskManagementTool()

    if event_type == "PULL_REQUEST_CREATED":
        pr_url = payload.get("data", {}).get("pr_url")
        logging.info(f"[Webhook] Jules created PR {pr_url} for Task {task_id}")
        
        # Update task status to REVIEW
        result = task_tool.update_task_status(
            task_id=task_id,
            status="REVIEW",
            pr_url=pr_url
        )
        logging.info(f"[Webhook] Task update result: {result}")
        return {"status": "processed", "action": "updated_task_review"}

    elif event_type == "SESSION_COMPLETED":
        logging.info(f"[Webhook] Jules session completed for Task {task_id}")
        # Just log, or if no PR was created, maybe we failed?
        return {"status": "processed", "action": "log_completion"}

    elif event_type == "SESSION_FAILED":
        error = payload.get("error", "Unknown error")
        logging.error(f"[Webhook] Jules session failed for Task {task_id}: {error}")
        # Notify team or update status to error?
        # Maybe move back to CODING or blocked?
        # For now, just log.
        return {"status": "processed", "action": "log_failure"}

    return {"status": "ignored", "reason": "unknown_event_type"}
