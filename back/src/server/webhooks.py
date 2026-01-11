import os
import json
import logging
from typing import Dict, Any, List

from fastapi import APIRouter, HTTPException, BackgroundTasks, Header
from pydantic import BaseModel
from agno.agent import Agent
from agno.models.google import Gemini
from agno.db.postgres import PostgresDb
from sqlalchemy import text, create_engine
import requests
from github import Github

from src.agents.reviewer import build_reviewer_agent
from src.teams.development.models import ReviewerInput, ReviewVerdict, ReviewComment, AnalystOutput, ArchitectOutput

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

class GithubWebhookPayload(BaseModel):
    action: str
    pr_number: int
    repository: str # owner/repo
    branch: str
    diff: str # Passed from Go or fetched here
    installation_id: int # Needed for GithubTools auth

def process_pr_review(payload: GithubWebhookPayload, internal_secret: str):
    """
    Background task to perform the review.
    """
    logger.info(f"Starting PR Review for {payload.repository} PR #{payload.pr_number}")

    if not engine:
        logger.error("DB Engine not initialized, cannot review PR")
        return

    # 1. Initialize Reviewer Agent
    try:
         reviewer = build_reviewer_agent(model=MODEL)
    except Exception as e:
         logger.error(f"Failed to build reviewer agent: {e}")
         return

    # 2. Fetch Task and Specs
    analyst_output = None
    architect_output = None
    specs_data = {}

    try:
        with engine.connect() as conn:
            query = text("""
                SELECT specs FROM project_tasks
                WHERE specs::jsonb ->> 'branch' = :branch
                LIMIT 1
            """)
            result = conn.execute(query, {"branch": payload.branch}).fetchone()

            if not result:
                logger.warning(f"No task found for branch {payload.branch}")
                return

            specs_data = result[0]
            if isinstance(specs_data, str):
                 specs_data = json.loads(specs_data)

            analyst_data = specs_data.get("analyst_output")
            architect_data = specs_data.get("architect_output")

            if not analyst_data or not architect_data:
                logger.warning("Task found but specs are incomplete")
                return

            analyst_output = AnalystOutput(**analyst_data)
            architect_output = ArchitectOutput(**architect_data)

    except Exception as e:
        logger.error(f"Database error: {e}")
        return

    # 3. Run Review
    logger.info("Running Reviewer Agent...")
    try:
        # Fetch Real Diff using PyGithub
        github_token = os.getenv("GITHUB_TOKEN")
        gh = Github(github_token) if github_token else None

        real_diff = payload.diff
        real_files = []

        if gh and not real_diff:
            try:
                repo = gh.get_repo(payload.repository)
                pr = repo.get_pull(payload.pr_number)

                # Fetch diff with authentication headers
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

        input_data = ReviewerInput(
           pr_diff=real_diff or "No diff provided",
           analyst_output=analyst_output,
           architect_output=architect_output,
           file_list=real_files
        )

        # Run agent
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
                        WHERE specs::jsonb ->> 'branch' = :branch
                    """)
                    conn.execute(update_q, {"branch": payload.branch})
                    conn.commit()
                    logger.info("Task status reverted to CODING")
             except Exception as db_err:
                 logger.error(f"Failed to update DB status: {db_err}")

        # 6. Chat Notification
        try:
             chat_id = specs_data.get("chat_id")
             if chat_id:
                  go_api_url = os.getenv("GO_API_URL", "http://localhost:8080")
                  # internal_secret already passed/available

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

@router.post("/notify-lead")
async def notify_team_lead(notification: ProjectTaskNotification):
    """
    Receive task status change notifications and trigger Workflow.
    """
    logger.info(f"Received ProjectTask update: Task {notification.task_id} transitioned from {notification.old_status} to {notification.new_status}")

    # Map Status -> Agent Role
    # BACKLOG -> ANALYSIS: Analyst
    # ANALYSIS -> PLANNING: Architect
    # PLANNING -> CODING: Worker
    # REVIEW -> VERIFY: Verifier (not implemented as separate agent trigger yet, but Reviewer handles loop)
    # CODING -> REVIEW: Reviewer
    
    status_to_role = {
        "ANALYSIS": "Analyst",
        "PLANNING": "Architect",
        "CODING": "Worker",
        "REVIEW": "Reviewer",
        "VERIFY": "Verifier"
    }

    role = status_to_role.get(notification.new_status)
    if not role:
        logger.info(f"No agent mapping for status {notification.new_status}, ignoring notification.")
        return {"status": "ignored", "task_id": notification.task_id}

    try:
        from src.teams.development.team import DevelopmentTeam
        
        db_url = os.getenv("DB_DSN")
        if db_url and db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql://", 1)

        # Instantiate team
        team = DevelopmentTeam(
            model=MODEL, # MODEL is Gemini from webhooks.py
            user_id=notification.user_id,
            db_url=db_url,
            github_token=os.getenv("GITHUB_TOKEN")
        )

        # Run the component
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
