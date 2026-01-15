import logging
import os
from typing import Dict, Any, Optional

from fastapi import APIRouter, Request, Header, HTTPException
from src.tools.task_manager import TaskManagementTool

# Create router for webhooks
router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger(__name__)

# Config
MODEL = Gemini(id="gemini-2.0-flash-thinking-exp-1219")

# Database Configuration
db_dsn = os.getenv("DB_DSN")
if db_dsn and db_dsn.startswith("postgres://"):
    db_dsn = db_dsn.replace("postgres://", "postgresql://", 1)

# Global Engine for Connection Pooling
engine = None
try:
    engine = create_engine(db_dsn, pool_size=5, max_overflow=10)
except Exception as e:
    logger.error(f"Failed to create DB engine: {e}")

class ProjectTaskNotification(BaseModel):
    user_id: str
    project_id: str
    task_id: str
    old_status: str
    new_status: str
    timestamp: Optional[Any] = None
    event: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class GithubWebhookPayload(BaseModel):
    action: str
    pr_number: int
    repository: str # owner/repo
    branch: str
    diff: str # Passed from Go or fetched here
    installation_id: int # Needed for GithubTools auth

class JulesWebhookPayload(BaseModel):
    event: str  # e.g., "SESSION_COMPLETED"
    sessionId: str
    labels: Dict[str, str]  # Contains task_id
    artifacts: Optional[List[Dict[str, Any]]] = None
    error: Optional[str] = None

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

        # Run the component
        if role == "Reviewer" and notification.event == "pr_opened":
             # Extract PR URL from metadata
             pr_url = ""
             if notification.metadata:
                 pr_url = notification.metadata.get("pr_url", "")

             if pr_url:
                 # Update state machine first (this also triggers the component)
                 team.handle_pr_created(pr_url)
                 return {"status": "triggered_via_pr_event", "role": role, "task_id": notification.task_id}
             else:
                 # Fallback to just running the component, assuming state will sync later or is not critical
                 logger.warning(f"PR URL missing in notification for task {notification.task_id}")

        team.run_component(role, notification.task_id)
        return {"status": "triggered", "role": role, "task_id": notification.task_id}

    except Exception as e:
        logger.error(f"Failed to trigger {role}: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}

@router.post("/github")
async def handle_github_webhook(
    payload: GithubWebhookPayload,
    background_tasks: BackgroundTasks,
    x_internal_secret: str = Header(None)
):
    internal_key = os.getenv("INTERNAL_API_KEY", "jules-secret-key")
    if x_internal_secret != internal_key:
        raise HTTPException(status_code=403, detail="Unauthorized")

    background_tasks.add_task(process_pr_review, payload, x_internal_secret)

    return {"status": "accepted", "message": "Review queued"}

@router.post("/jules")
async def handle_jules_webhook(
    payload: JulesWebhookPayload
):
    logger.info(f"Received Jules Webhook: {payload.event} for session {payload.sessionId}")

    if payload.event != "SESSION_COMPLETED":
        logger.info(f"Ignoring event {payload.event}")
        return {"status": "ignored", "reason": "not completed"}

    task_id = payload.labels.get("task_id")
    if not task_id:
        logger.error("No task_id in Jules webhook labels")
        raise HTTPException(status_code=400, detail="Missing task_id label")

    # Extract PR URL from artifacts
    pr_url = None
    if payload.artifacts:
        for artifact in payload.artifacts:
             # Check for pull request artifact (adjust key based on Jules actual response)
             if artifact.get("type") == "pull_request" and "url" in artifact:
                 pr_url = artifact["url"]
                 break
             # Fallback: Check if it's inside some nested structure
             if "pullRequest" in artifact:
                 pr_url = artifact["pullRequest"].get("url")
                 break

    if not engine:
         logger.error("DB Engine not initialized")
         raise HTTPException(status_code=500, detail="DB Error")

    try:
        with engine.connect() as conn:
            # 1. Fetch current artifacts/specs to merge
            # Although we only need to append jules_output, it's safer to read-modify-write if we don't use jsonb_set
            # But jsonb_set is better for concurrency.
            # Let's try to append to artifacts using jsonb_set or || operator

            # Update query:
            # Set status to REVIEW
            # Add/Update 'jules_output' in artifacts (renamed from specs in some contexts, but 'specs' column is used in previous code?)
            # Wait, previous code uses `specs::jsonb`. The memory says `ProjectTask` struct has `Artifacts` field (renamed from `Specs`).
            # The column in DB might still be `specs` or `artifacts`.
            # In `process_pr_review`, it uses `specs::jsonb`.
            # I will follow `process_pr_review` pattern and assume column is `specs`.

            jules_output = {
                "pr_url": pr_url,
                "session_id": payload.sessionId,
                "completed_at": "now()" # simplistic
            }

            # We update status to REVIEW ('REVIEW_NEEDED' in prompt, but codebase uses 'REVIEW' constant in Go,
            # which maps to `storage.ProjectTaskStatusReview`).
            # In `process_pr_review`, check `ProjectTaskStatusReview` logic.
            # The prompt says "REVIEW_NEEDED" but also "storage.ProjectTaskStatusReview".
            # The Python code uses "CODING" in revert.
            # Let's assume 'REVIEW' is the correct string for the enum in DB.

            query = text("""
                UPDATE project_tasks
                SET
                    specs = specs::jsonb || jsonb_build_object('jules_output', :jules_data),
                    updated_at = now()
                WHERE id = :task_id
            """)

            conn.execute(query, {
                "task_id": task_id,
                "jules_data": json.dumps(jules_output)
            })
            conn.commit()

            logger.info(f"Task {task_id} artifacts updated with PR {pr_url}")

            # Notify Go backend about status change
            go_api_url = os.getenv("GO_API_URL", "http://localhost:8080")
            internal_secret = os.getenv("INTERNAL_API_KEY", "jules-secret-key")

            headers = {"X-Internal-Secret": internal_secret}

            # 2. Update Status via API to trigger events
            patch_url = f"{go_api_url}/api/project-tasks/{task_id}/status"
            requests.patch(patch_url, json={"status": "REVIEW"}, headers=headers)

            logger.info(f"Task {task_id} status patched to REVIEW via API")

    except Exception as e:
        logger.error(f"Failed to process Jules webhook: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return {"status": "processed", "task_id": task_id}
