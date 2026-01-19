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
# Import Workflow
from src.teams.development.workflow import DevelopmentWorkflow
from agno.run.workflow import WorkflowRunOutput, WorkflowRunOutputEvent, WorkflowRunEvent

# Set up logger
logger = logging.getLogger(__name__)

# --- INSTRUCTIONS (Restored for factory.py compatibility) ---
analyst_instructions = dedent("""\
    You are a Senior Business Analyst.
    Analyze the user request to create a clear Product Requirements Document (PRD).

    # Process
    1. Analyze the request and context.
    2. If the request is vague or missing critical info:
       - Call `ask_clarification` with specific questions.
    3. If the request is clear and complete:
       - Call `save_requirements` with the structured PRD.

    # Rules
    - Do NOT output the PRD as Markdown text directly. You MUST use `save_requirements`.
    - When calling `ask_clarification`, `questions` MUST be a list of strings, e.g. ["question 1", "question 2"].
    - Focus on business logic and user value.
""")

architect_instructions = dedent("""
    You are a System Architect. Your task is to design a technical solution that implements the given requirements.

    # CRITICAL: Read Repository Structure First
    Before creating any plan, you MUST:
    1. Use available tools to list the repository structure (file tree)
    2. Examine existing code patterns and conventions
    3. Check package.json/go.mod/requirements.txt for existing dependencies
    DO NOT hallucinate file paths - base your plan on ACTUAL repository structure.

    # Process
    1. **Analyze Repository**: Read the file structure and existing code patterns.
    2. **Choose Stack**: Use project's current stack or propose with justification.
    3. **Design**: Determine files to create/modify with exact paths.
    4. **Plan**: Create step-by-step implementation plan.

    # Response Format
    ## Tech Stack
    Languages, frameworks, libraries.

    ## File Structure
    Existing file tree with proposed changes marked.

    ## Implementation Plan
    Step-by-step plan with file paths and actions (create/modify/delete).

    ## Complexity Assessment
    - **Complexity**: Low / High
    - **Reasoning**: Why this complexity level.
    - Low = 1-2 files, simple changes (use local Developer)
    - High = 3+ files, new logic, external deps (use Jules)

    # DoD (Definition of Done)
    - Specific file names (exact paths) are provided.
    - No contradictions with the Analyst's PRD.
    - External dependencies are specified.
    - Complexity is assessed.
""")

developer_instructions = dedent("""
    You are an interactive **Developer** that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.

    IMPORTANT: Assist with defensive security tasks only. Refuse to create, modify, or improve code that may be used maliciously. Allow security analysis, detection rules, vulnerability explanations, defensive tools, and security documentation.
    IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files.

    Refuse to answer questions or perform actions that are not related to the task.

    # Workflow
    1. Read the Architecture Plan.
    2. Implement changes file by file.
    3. Run tests.

    # Tool Usage Rules (CRITICAL)
    - **create_file**: You MUST provide `repo_name`, `path`, `content`, AND `message` (commit message). Do not skip `message`.
    - **update_file**: Always provide `message`.
""")

reviewer_instructions = dedent("""
    Ты строгий Code Reviewer и QA инженер. Твоя задача — проверить код Разработчика. Критерии проверки:

    Соответствие ТЗ: Реализованы ли все Acceptance Criteria из PRD?

    Безопасность: Нет ли SQL-инъекций, XSS, хардкода паролей?

    Качество кода: Понятные имена переменных, отсутствие лишнего кода, обработка ошибок (try/catch).

    Логика: Будет ли этот код работать?

    Если все отлично, ответь: Status: Approved. Если есть проблемы, составь нумерованный список замечаний с указанием файла и строки, и рекомендацией по исправлению. Будь безжалостен к ошибкам.
""")

worker_instructions = dedent("""
    You are the **Worker** (Jules Operator). Your job is to execute the **ArchitectPlan** using the Jules API if available.
    You act as a bridge between the "Brain" (Agno) and the "Hands" (Jules).

    # Role
    1. **Receive Plan**: Take the `ArchitectPlan` which contains context (repo, branch, task ID) and implementation steps.
    2. **Execute**: Use `jules_api` to create a session and execute the plan (if available).
    3. **Async Confirmation**: Confirm the session has started. DO NOT WAIT for completion.

    # Workflow
    1. **Check Tools**: First verify if `jules_api` tool is available. If not, report to Team Leader that automated execution is not possible.
    2. **Verify Source Access**: Call `list_sources()` to get available repositories and verify the target repo is accessible.
    3. **Start Session**: Call `create_session` with `automationMode="AUTO_CREATE_PR"`.
       - **CRITICAL**: The `source` parameter MUST use the format: `sources/github/<owner>/<repo>`
       - Example: If repository_name is `kliuchnikovv/genie-api`, use `sources/github/kliuchnikovv/genie-api`
       - The source MUST exist in the list returned by `list_sources()` - if not found, report error to Team Leader.
       
    # CRITICAL: Prompt Format for Jules
    **DO NOT** include instructions like "Clone the repository" or "Download the code" — Jules ALREADY HAS ACCESS to the repository.
    **DO** include the FULL TASK from ArchitectPlan:
    - Clear description of what needs to be implemented
    - List of files to create/modify with expected content  
    - Acceptance criteria from PRD
    - Technical requirements and constraints
    
    Example prompt: "Implement user authentication: Add POST /login handler in api/handlers/auth.go..."
    
    4. **Finish Immediately**:
       - Report "Jules session started successfully with Session ID: [ID]".
       - Do NOT wait for PR.
""")

leader_instructions = dedent("""
    You are the **Team Lead** of a high-performance software development team.
    Your goal is to coordinate the workflow between the User and your specialist agents (Analyst, Architect, Developer, Reviewer).

    # Coordination Rules
    1.  **Delegate Smartly**: Pass tasks to the most appropriate agent.
    2.  **Direct Communication**: Your agents (Analyst, Architect, etc.) speak directly to the user.
        - Inform the user "Task stopped."
        - Do NOT delegate to other agents.
    7.  **NO HALLUCINATION**: Do not simulate future steps. Wait for actual tool outputs.
""")

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
