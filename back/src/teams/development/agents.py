from textwrap import dedent
from typing import List, Optional, Any
import os
from agno.agent import Agent
from agno.models.base import Model
from agno.tools import Toolkit
from agno.tools.github import GithubTools

from src.teams.development.models import (
    AnalystOutput,
    ArchitectPlan,
    ReviewVerdict,
    FinalAcceptance,
)
from src.tools.task_manager import TaskManagementTool
from src.rag_service import KnowledgeSearchTool
from src.tools.jules import JulesTools
from src.tools.git import GitTools


# --- ANALYST ---
class AnalystAgent(Agent):
    def __init__(
        self,
        model: Model,
        task_tool: TaskManagementTool,
        knowledge_tool: Optional[KnowledgeSearchTool] = None,
        github_tool: Optional[GithubTools] = None,
        client_tools: Optional[List[Toolkit]] = None,
        debug_mode: bool = False,
        task_id: Optional[str] = None
    ):
        self.task_tool = task_tool
        self.task_id = task_id
        
        import logging
        logger = logging.getLogger(__name__)
        logger.info("[AnalystAgent] Initialized with task_id=%s", task_id)

        tools = [self.save_requirements, self.ask_clarification, task_tool]
        if knowledge_tool:
            tools.append(knowledge_tool)
        if github_tool:
            tools.append(github_tool)
        if client_tools:
            tools.extend(client_tools)

        super().__init__(
            name="Analyst",
            role="Business Analyst",
            id="analyst",
            model=model,
            instructions=dedent("""\
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
            """),
            tools=tools,
            markdown=True,
            debug_mode=debug_mode,
        )

    def save_requirements(
        self,
        summary: str,
        user_stories: List[str],
        functional_requirements: List[str],
        acceptance_criteria: List[str]
    ):
        """
        Finalize analysis and save the PRD.
        Call this when requirements are clear and complete.

        Args:
            summary: High-level description of the task.
            user_stories: List of "As a <role>, I want <feature>" strings.
            functional_requirements: List of explicit system behaviors.
            acceptance_criteria: List of conditions for Done (DoD).
        """
        # Create the artifact structure
        artifact = {
            "summary": summary,
            "user_stories": user_stories,
            "functional_requirements": functional_requirements,
            "acceptance_criteria": acceptance_criteria
        }

        # Save artifact and update status to PLANNING via TaskTool
        # If task_id is known (injected at init or found in context), use it.
        # Ideally, the agent context has it, but for now we rely on self.task_id or passed in tools

        task_id = self.task_id
        if not task_id:
            return "Error: No task_id available to save requirements. I lack a task_id to save requirements. Please ask the Team Leader to provide the task context or use list_projects to find available projects."

        # Update task status to PLANNING
        result = self.task_tool.update_task_status(
            task_id=task_id,
            status="PLANNING",
            artifacts=artifact
        )
        return f"Requirements saved. Transitioning to PLANNING. Result: {result}"

    def ask_clarification(self, questions: List[str], context: Optional[str] = None):
        """
        Request more details from the user.
        Call this if requirements are vague or missing critical info.
        This triggers a transition to CLARIFICATION_NEEDED state.

        Args:
            questions: List of specific clarifying questions (max 5). Example: ["What is the target audience?", "Do you need a database?"]
            context: Optional context explaining why clarification is needed.
        """
        task_id = self.task_id
        if task_id:
            self.task_tool.update_task_status(
                task_id=task_id,
                status="CLARIFICATION_NEEDED"
            )
        
        return {
            "type": "CLARIFICATION_NEEDED",
            "questions": questions,
            "context": context
        }


# --- ARCHITECT ---
class ArchitectAgent(Agent):
    def __init__(
        self,
        model: Model,
        tools: List[Toolkit],
        debug_mode: bool = False
    ):
        super().__init__(
            name="Architect",
            role="Architect",
            id="architect",
            model=model,
            instructions=dedent("""
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
            """),
            tools=tools,
            markdown=True,
            debug_mode=debug_mode,
        )


# --- DEVELOPER ---
class DeveloperAgent(Agent):
    def __init__(
        self,
        model: Model,
        tools: List[Toolkit],
        git_tool: Optional[GitTools] = None,
        debug_mode: bool = False
    ):
        agent_tools = tools if tools else []
        if git_tool:
            agent_tools.append(git_tool)

        super().__init__(
            name="Developer",
            role="Developer",
            id="developer",
            model=model,
            instructions=dedent("""
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
            """),
            tools=agent_tools,
            markdown=True,
            debug_mode=debug_mode,
        )


# --- REVIEWER ---
class ReviewerAgent(Agent):
    def __init__(
        self,
        model: Model,
        tools: List[Toolkit],
        git_tool: Optional[GitTools] = None,
        debug_mode: bool = False
    ):
        agent_tools = tools if tools else []
        if git_tool:
            agent_tools.append(git_tool)

        super().__init__(
            name="Reviewer",
            role="Reviewer",
            id="reviewer",
            model=model,
            instructions=dedent("""
                Ты строгий Code Reviewer и QA инженер. Твоя задача — проверить код Разработчика. Критерии проверки:

                Соответствие ТЗ: Реализованы ли все Acceptance Criteria из PRD?

                Безопасность: Нет ли SQL-инъекций, XSS, хардкода паролей?

                Качество кода: Понятные имена переменных, отсутствие лишнего кода, обработка ошибок (try/catch).

                Логика: Будет ли этот код работать?

                Если все отлично, ответь: Status: Approved. Если есть проблемы, составь нумерованный список замечаний с указанием файла и строки, и рекомендацией по исправлению. Будь безжалостен к ошибкам.
            """),
            tools=agent_tools,
            markdown=True,
            debug_mode=debug_mode,
        )


# --- WORKER (JULES) ---
class WorkerAgent(Agent):
    def __init__(
        self,
        model: Model,
        task_tool: TaskManagementTool,
        jules_api_key: Optional[str] = None,
        client_tools: Optional[List[Toolkit]] = None,
        debug_mode: bool = False
    ):

        # Build tools list
        tools = [task_tool]

        # Check if JulesTools is already in client_tools
        jules_tool_exists = False
        if client_tools:
            for tool in client_tools:
                if isinstance(tool, JulesTools):
                    jules_tool_exists = True
                    break

        effective_key = jules_api_key or os.getenv("JULES_API_KEY", "")
        if not jules_tool_exists and effective_key:
             tools.insert(0, JulesTools(api_key=effective_key))

        if client_tools:
            tools.extend(client_tools)

        super().__init__(
            name="Worker",
            role="Worker",
            id="worker",
            model=model,
            instructions=dedent("""
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
            """),
            tools=tools,
            markdown=True,
            debug_mode=debug_mode,
        )


# --- VERIFIER (DOD Checker) ---
class VerifierAgent(Agent):
    """
    Verifier Agent with DOD (Definition of Done) checking capabilities.
    Performs final validation before task completion.
    """
    def __init__(
        self,
        model: Model,
        tools: Optional[List[Toolkit]] = None,
        debug_mode: bool = False
    ):
        agent_tools = tools if tools else []
        
        super().__init__(
            name="Verifier",
            role="QA Engineer / DOD Checker",
            id="verifier",
            model=model,
            instructions=dedent("""
                You are the **Verifier / DOD Checker**. You are the final quality gate before delivery.
                Your job is to verify that the implementation meets ALL acceptance criteria from the PRD.

                # Verification Checklist
                1. **Acceptance Criteria**: Check EACH criterion from the PRD.
                2. **Linter Check**: Run lint commands if available (e.g., `ruff check`, `eslint`).
                3. **Test Execution**: Run test commands if available (e.g., `pytest`, `go test`).
                4. **Security Scan**: Check for obvious security issues (hardcoded secrets, SQL injection, XSS).
                5. **Code Quality**: Verify code follows project conventions.

                # Output Format (Markdown)
                ## ✅ DOD Verification Result
                - **Status**: PASS / FAIL
                - **Reason**: [Explanation]

                ## 📋 Acceptance Criteria Check
                For each criterion from PRD:
                - [x] Criterion 1: [Pass with evidence]
                - [ ] Criterion 2: [Fail - reason]

                ## 🧪 Test Results
                - Tests Run: [command used]
                - Result: [Pass/Fail with summary]

                ## 🔍 Linter Results
                - Linter Run: [command used]
                - Result: [Pass/Fail with issues if any]

                ## 🔐 Security Check
                - [ ] No hardcoded secrets
                - [ ] No SQL injection vulnerabilities
                - [ ] No XSS vulnerabilities

                # Decision
                If ALL checks pass: Return **PASS** - ready for DELIVERY_HANDOFF.
                If ANY check fails: Return **FAIL** - needs to return to DEVELOPMENT.
            """),
            tools=agent_tools,
            markdown=True,
            debug_mode=debug_mode,
        )

