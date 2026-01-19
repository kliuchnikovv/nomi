from textwrap import dedent
from typing import Optional, List, Any, Iterator
import os
import redis
import logging

from agno.db import BaseDb
from agno.models.base import Model
from agno.team import Team
from agno.tools import Toolkit
from src.tools.factory import SafeGithubTools

from src.workflow.agent import PgWorkflowStorage
from src.tools.task_manager import TaskManagementTool
from src.rag_service import KnowledgeSearchTool
from src.tools.git import GitTools

# Import agents
from src.teams.development.agents import (
    AnalystAgent,
    ArchitectAgent,
    DeveloperAgent,
    ReviewerAgent,
    WorkerAgent,
    VerifierAgent,
)
from src.teams.development.prompts import (
    ANALYST_INSTRUCTIONS,
    ARCHITECT_INSTRUCTIONS,
    DEVELOPER_INSTRUCTIONS,
    REVIEWER_INSTRUCTIONS,
    WORKER_INSTRUCTIONS,
    TEAM_LEAD_INSTRUCTIONS,
)
# Import Workflow
from src.teams.development.workflow import DevelopmentWorkflow
from agno.run.workflow import WorkflowRunOutput, WorkflowRunOutputEvent, WorkflowRunEvent

# Set up logger
logger = logging.getLogger(__name__)

# --- INSTRUCTIONS (Restored for factory.py compatibility) ---
# --- INSTRUCTIONS (Restored for factory.py compatibility) ---
analyst_instructions = ANALYST_INSTRUCTIONS
architect_instructions = ARCHITECT_INSTRUCTIONS
developer_instructions = DEVELOPER_INSTRUCTIONS
reviewer_instructions = REVIEWER_INSTRUCTIONS
worker_instructions = WORKER_INSTRUCTIONS
leader_instructions = TEAM_LEAD_INSTRUCTIONS

class DevelopmentTeam(Team):
    def __init__(
        self,
        model: Model,
        db: BaseDb | None = None,
        github_token: Optional[str] = None,
        jules_api_key: Optional[str] = None,
        markdown: bool = True,
        debug_mode: bool = False,
        user_id: Optional[str] = None,
        auth_token: Optional[str] = None,
        project_id: Optional[str] = None,
        task_id: Optional[str] = None,
        db_url: Optional[str] = None,
        client_tools: Optional[List[Toolkit]] = None,
    ):
        # Initialize GitHub tools if token is provided
        github_tool = SafeGithubTools(access_token=github_token) if github_token else None
        self.github_tool = github_tool
        
        # Initialize Git Tool (Local)
        git_tool = GitTools(repo_path=".", allow_destructive=False)

        # Initialize Task Tool
        task_tool = TaskManagementTool(user_id=user_id, auth_token=auth_token)
        knowledge_tool = KnowledgeSearchTool(user_id=user_id, auth_token=auth_token) if user_id else None

        # 1. Analyst
        self.analyst = AnalystAgent(
            model=model,
            task_tool=task_tool,
            knowledge_tool=knowledge_tool,
            github_tool=github_tool,
            client_tools=client_tools,
            debug_mode=debug_mode,
            task_id=task_id,
        )

        # 2. Architect
        architect_tools = [task_tool]
        if github_tool:
            architect_tools.append(github_tool)
        if client_tools:
            architect_tools.extend(client_tools)
        
        self.architect = ArchitectAgent(
            model=model,
            tools=architect_tools,
            debug_mode=debug_mode
        )

        # 3. Developer
        developer_tools = []
        if github_tool:
            developer_tools.append(github_tool)
        if client_tools:
            developer_tools.extend(client_tools)

        self.developer = DeveloperAgent(
            model=model,
            tools=developer_tools,
            git_tool=git_tool,
            debug_mode=debug_mode
        )

        # 4. Reviewer
        reviewer_tools = []
        if github_tool:
            reviewer_tools.append(github_tool)
        if client_tools:
            reviewer_tools.extend(client_tools)

        self.reviewer = ReviewerAgent(
            model=model,
            tools=reviewer_tools,
            git_tool=git_tool,
            debug_mode=debug_mode
        )

        # 5. Worker
        self.worker = WorkerAgent(
            model=model,
            task_tool=task_tool,
            jules_api_key=jules_api_key,
            client_tools=client_tools,
            debug_mode=debug_mode
        )

        # 6. Verifier
        verifier_tools = []
        if git_tool:
             verifier_tools.append(git_tool)
        if github_tool:
             verifier_tools.append(github_tool)
        if client_tools:
             verifier_tools.extend(client_tools)

        self.verifier = VerifierAgent(
            model=model,
            tools=verifier_tools,
            debug_mode=debug_mode
        )

        # Workflow Storage
        self.workflow_storage = PgWorkflowStorage(db_url) if db_url else None
        self.user_id = user_id
        self.project_id = project_id
        self.task_id = task_id
        self.auth_token = auth_token
        
        # Initialize Workflow
        self.workflow = DevelopmentWorkflow(
            analyst=self.analyst,
            architect=self.architect,
            developer=self.developer,
            reviewer=self.reviewer,
            worker=self.worker,
            verifier=self.verifier,
            workflow_storage=self.workflow_storage,
            task_id=task_id,
            project_id=project_id,
        )

        super().__init__(
            name="Development Team",
            id="development-team",
            model=model,
            instructions=leader_instructions,
            user_id=user_id,
            debug_mode=debug_mode,
            members=[self.analyst, self.architect, self.developer, self.reviewer, self.worker, self.verifier],
        )
        
        self.members = self.members

    def check_cancellation(self) -> bool:
        """Checks if the user has requested to stop the operation."""
        if not self.task_id:
            return False
            
        try:
            redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
            r = redis.from_url(redis_url, decode_responses=True)
            if r.get(f"chat:stop:{self.task_id}"):
                print(f"[Team] Cancellation detected for task {self.task_id}")
                return True
        except Exception as e:
            print(f"[Team] Error checking cancellation: {e}")
            
        return False

    def run(
        self,
        message: Optional[str] = None,
        stream: bool = False,
        **kwargs,
    ) -> Any:
        if not self.task_id:
            return super().run(message=message, stream=stream, **kwargs)

        if self.check_cancellation():
             return "PROCESS_STOPPED_BY_USER"

        full_message = self._inject_context(message)
        logger.info(f"[Team] Running Workflow for Task {self.task_id}")
        
        try:
            if stream:
                 iterator = self.workflow.run(input=full_message, stream=True, stream_events=True, **kwargs)
                 return self._stream_adapter(iterator)
            else:
                 output = self.workflow.run(input=full_message, stream=False, **kwargs)
                 return self._response_adapter(output)
                 
        except Exception as e:
             logger.error(f"Workflow execution failed: {e}")
             return f"Error executing workflow: {e}"

    def _inject_context(self, message: Optional[str]) -> str:
        if not message: return ""
        
        context_lines = []
        if self.project_id:
            context_lines.append(f"**Current Project ID**: `{self.project_id}`.")
        if self.task_id:
            context_lines.append(f"**Current Task ID**: `{self.task_id}`.")
        if self.github_tool:
            try:
                if hasattr(self.github_tool, "list_repos"):
                     repos = self.github_tool.list_repos(limit=50)
                     context_lines.append(f"Repos: {repos}")
            except Exception: pass
            
        if context_lines:
            return message + "\n\n[SYSTEM CONTEXT]\n" + "\n".join(context_lines)
        return message

    def _stream_adapter(self, iterator: Iterator[Any]) -> Iterator[Any]:
        for event in iterator:
             yield event

    def _response_adapter(self, output: WorkflowRunOutput) -> Any:
        return output
