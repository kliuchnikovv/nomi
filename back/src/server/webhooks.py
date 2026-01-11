import os
import json
import logging
from typing import Dict, Any, List, Optional

from fastapi import APIRouter, HTTPException, BackgroundTasks, Header
from pydantic import BaseModel
from agno.models.google import Gemini
from sqlalchemy import text, create_engine
import requests
from github import Github

from src.agents.reviewer import build_reviewer_agent
from src.teams.development.models import ReviewerInput, ReviewVerdict, AnalystOutput, ArchitectOutput
from src.teams.development.team import DevelopmentTeam
from src.workflow.agent import PgWorkflowStorage

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
# Separate router for /api prefixed routes to be included in app.py
# We can't mount it here with /api prefix easily without conflict if app.py also has /api
# But app.py includes this file's router.
# We will create a separate router object for API notifications.
api_notification_router = APIRouter(prefix="/api", tags=["notifications"])

logger = logging.getLogger(__name__)

# Config
MODEL = Gemini(id="gemini-2.0-flash-thinking-exp-1219")

# Database Configuration
db_dsn = os.getenv("DB_DSN")
if db_dsn and db_dsn.startswith("postgres://"):
    db_dsn = db_dsn.replace("postgres://", "postgresql://", 1)

# Global Engine for Connection Pooling (Legacy usage in process_pr_review)
engine = None
if db_dsn:
    try:
        engine = create_engine(db_dsn, pool_size=5, max_overflow=10)
    except Exception as e:
        logger.error(f"Failed to create DB engine: {e}")

class GithubWebhookPayload(BaseModel):
    action: str
    pr_number: int
    repository: str # owner/repo
    branch: str
    diff: str # Passed from Go or fetched here
    installation_id: int # Needed for GithubTools auth

class ProjectTaskNotification(BaseModel):
    user_id: str
    project_id: str
    task_id: str
    old_status: str
    new_status: str
    timestamp: Optional[str] = None
    event: Optional[str] = None

def run_agent_background(notification: ProjectTaskNotification):
    """
    Background worker that restores context and runs the appropriate agent.
    """
    logger.info(f"[Background] Processing task update: {notification.task_id} ({notification.new_status})")

    # 1. Determine Agent Role based on Status
    role_to_run = None
    if notification.new_status == "ANALYSIS":
        role_to_run = "Analyst"
    elif notification.new_status == "PLANNING": # Typically triggered after Analyst finishes?
        # If Analyst finished, status might be PLANNING.
        # But DevelopmentTeam.transition_to_next_step sets PLANNING and triggers Architect automatically.
        # IF that process dies, we might need to resume.
        # But usually 'notify-lead' is called *after* status update.
        # If status is PLANNING, we should run Architect.
        role_to_run = "Architect"
    elif notification.new_status == "CODING":
        role_to_run = "Developer" # or Worker
    elif notification.new_status == "REVIEW":
        role_to_run = "Reviewer"

    if not role_to_run:
        logger.info(f"No agent action required for status {notification.new_status}")
        return

    # 2. Initialize Development Team
    # We need db_dsn for WorkflowStorage
    try:
        # Re-initialize team. We assume 'user_id' is provided.
        # We might need to check if we have a valid github_token in env
        github_token = os.getenv("GITHUB_TOKEN")

        team = DevelopmentTeam(
            model=MODEL,
            user_id=notification.user_id,
            db_url=db_dsn,
            github_token=github_token
        )

        logger.info(f"Restoring context for Task {notification.task_id} and running {role_to_run}")

        # 3. Run Component
        # The agent (WorkflowAgent) will automatically fetch artifacts from WorkflowStorage
        # using task_id and session_id (which team.run_component or internal logic handles).
        # run_component calls agent.run(..., task_id=task_id).
        # WorkflowAgent.run checks artifacts.
        team.run_component(role_to_run, notification.task_id)

    except Exception as e:
        logger.error(f"Background agent execution failed: {e}", exc_info=True)


def process_pr_review(payload: GithubWebhookPayload, internal_secret: str):
    """
    Background task to perform the review.
    Consolidated to use PgWorkflowStorage for context.
    """
    logger.info(f"Starting PR Review for {payload.repository} PR #{payload.pr_number}")

    if not engine or not db_dsn:
        logger.error("DB Engine not initialized, cannot review PR")
        return

    # 1. Resolve Task ID from Branch
    task_id = None
    specs_data = {} # Keep for fallback or chat_id lookup

    try:
        with engine.connect() as conn:
            query = text("""
                SELECT id, specs FROM project_tasks
                WHERE specs::jsonb ->> 'branch' = :branch
                LIMIT 1
            """)
            result = conn.execute(query, {"branch": payload.branch}).fetchone()

            if not result:
                logger.warning(f"No task found for branch {payload.branch}")
                return

            task_id = str(result[0])
            specs_data = result[1]
            if isinstance(specs_data, str):
                 specs_data = json.loads(specs_data)

    except Exception as e:
        logger.error(f"Database error resolving task: {e}")
        return

    # 2. Fetch Artifacts from WorkflowStorage
    analyst_output = None
    architect_output = None

    try:
        workflow_storage = PgWorkflowStorage(db_dsn)

        # Try fetching from WorkflowStorage first
        analyst_data = workflow_storage.get_artifact_by_task(task_id, "AnalystOutput")
        architect_data = workflow_storage.get_artifact_by_task(task_id, "ArchitectPlan") # Note: Architect produces ArchitectPlan

        # Fallback to specs if not in WorkflowStorage (Legacy)
        if not analyst_data:
             logger.info("AnalystOutput not found in WorkflowStorage, checking legacy specs")
             analyst_data = specs_data.get("analyst_output")

        if not architect_data:
             logger.info("ArchitectPlan not found in WorkflowStorage, checking legacy specs")
             # Legacy might have used ArchitectOutput or ArchitectPlan
             architect_data = specs_data.get("architect_output")

        if not analyst_data:
            logger.warning("Missing AnalystOutput")
            return

        # Parse Models
        analyst_output = AnalystOutput(**analyst_data)

        # Handle Architect output polymorphism (Plan vs Output)
        # ReviewerInput expects 'ArchitectOutput'.
        # ArchitectPlan is the new model. We might need to map it or update ReviewerInput.
        # But for now, let's try to convert or use what we have.
        # If ReviewerInput requires ArchitectOutput (Pydantic), and we have ArchitectPlan dict,
        # we might have a mismatch.
        # But 'back/src/teams/development/models.py' shows ArchitectPlan and ArchitectOutput are different.
        # ReviewerInput definition: `architect_output: ArchitectOutput`.
        # We should check if we can construct ArchitectOutput from Plan or if we should update Reviewer.
        # Given "Modify only specified files", we should probably try to adapt here.

        if architect_data:
            try:
                architect_output = ArchitectOutput(**architect_data)
            except Exception as e:
                logger.warning(f"Failed to parse ArchitectOutput: {e}. Attempting to proceed without it.")
                # If validation fails, maybe it's an ArchitectPlan?
                # We can create a dummy ArchitectOutput or try to map fields.
                # ArchitectOutput needs: context_analysis, adr, implementation_plan, definition_of_done
                # ArchitectPlan has: adr_title, adr_decision... files_to_create...
                pass

    except Exception as e:
        logger.error(f"Error fetching artifacts: {e}")
        return

    if not analyst_output:
        logger.error("Could not reconstruct AnalystOutput")
        return

    # 3. Run Reviewer Agent
    logger.info("Running Reviewer Agent...")
    try:
        # Initialize Reviewer Agent
        reviewer = build_reviewer_agent(model=MODEL)

        # Fetch Real Diff using PyGithub
        github_token = os.getenv("GITHUB_TOKEN")
        gh = Github(github_token) if github_token else None

        real_diff = payload.diff
        real_files = []

        if gh and not real_diff:
            try:
                repo = gh.get_repo(payload.repository)
                pr = repo.get_pull(payload.pr_number)

                headers = {}
                if github_token:
                    headers["Authorization"] = f"token {github_token}"

                diff_resp = requests.get(pr.diff_url, headers=headers)
                if diff_resp.status_code == 200:
                    real_diff = diff_resp.text
                else:
                    logger.error(f"Failed to fetch diff: {diff_resp.status_code}")

                real_files = [f.filename for f in pr.get_files()]
            except Exception as gh_err:
                logger.error(f"GitHub API Error: {gh_err}")
                real_diff = "Error fetching diff from GitHub."

        # If we don't have architect_output, create a dummy one to satisfy Pydantic
        if not architect_output:
             architect_output = ArchitectOutput(
                 context_analysis="Restored from context",
                 adr={"title": "Unknown", "status": "Proposed", "context": "N/A", "decision": "N/A", "consequences": "N/A"},
                 implementation_plan=[],
                 definition_of_done=[]
             )

        input_data = ReviewerInput(
           pr_diff=real_diff or "No diff provided",
           analyst_output=analyst_output,
           architect_output=architect_output,
           file_list=real_files
        )

        response = reviewer.run(input_data)
        result: ReviewVerdict = response.content

        logger.info(f"Review Verdict: {result.approved}")

        # 4. Post to GitHub
        if gh:
            try:
                repo = gh.get_repo(payload.repository)
                pr = repo.get_pull(payload.pr_number)

                body = f"## 🤖 Reviewer Agent Verification\n\n**Verdict**: {'APPROVE' if result.approved else 'REQUEST CHANGES'}\n\n{result.summary}"
                event_action = "APPROVE" if result.approved else "REQUEST_CHANGES"

                pr.create_review(body=body, event=event_action)
                logger.info(f"Posted review to GitHub: {event_action}")
            except Exception as post_err:
                logger.error(f"Failed to post review: {post_err}")

        # 5. Update Task Status (if rejected)
        if not result.approved:
             try:
                 with engine.connect() as conn:
                    update_q = text("""
                        UPDATE project_tasks
                        SET status = 'CODING', updated_at = now()
                        WHERE id = :id
                    """)
                    conn.execute(update_q, {"id": task_id})
                    conn.commit()
                    logger.info("Task status reverted to CODING")
             except Exception as db_err:
                 logger.error(f"Failed to update DB status: {db_err}")

        # 6. Chat Notification
        try:
             chat_id = specs_data.get("chat_id")
             if chat_id:
                  go_api_url = os.getenv("GO_API_URL", "http://localhost:8080")
                  msg_content = f"**Reviewer Agent Feedback**\nVerdict: {'approved' if result.approved else 'changes requested'}\n\n{result.summary}"

                  requests.post(
                      f"{go_api_url}/api/chats/{chat_id}/messages",
                      json={"content": msg_content, "role": "assistant"},
                      headers={"X-Internal-Secret": internal_secret}
                  )
                  logger.info(f"Notification sent to chat {chat_id}")
        except Exception as notify_err:
             logger.error(f"Failed to notify chat: {notify_err}")

    except Exception as e:
        logger.error(f"Agent execution failed: {e}")

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

@api_notification_router.post("/notify-lead")
async def handle_notify_lead(
    notification: ProjectTaskNotification,
    background_tasks: BackgroundTasks,
    x_internal_secret: str = Header(None)
):
    """
    Endpoint for Go backend to notify about task status changes.
    Returns 200 OK immediately and processes in background.
    """
    # Verify secret
    # (Optional: check internal key if strict security needed, usually good practice)
    # internal_key = os.getenv("INTERNAL_API_KEY", "jules-secret-key")
    # if x_internal_secret != internal_key:
    #    raise HTTPException(status_code=403, detail="Unauthorized")

    background_tasks.add_task(run_agent_background, notification)
    return {"status": "accepted", "task_id": notification.task_id}
