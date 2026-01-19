from textwrap import dedent
from typing import Optional, List, Any, Type
import os
import re
import json
import logging
from pydantic import BaseModel, TypeAdapter

from agno.agent import Agent
from agno.knowledge import Knowledge
from agno.db import BaseDb
from agno.models.base import Model
from agno.team import Team
from agno.tools import Toolkit
from src.tools.factory import SafeGithubTools
import requests
import redis

from src.agents.genie import GenieAgent
from src.teams.development.models import (
    AnalystOutput,
    ArchitectPlan,
    ReviewVerdict,
    FinalAcceptance,
    StateContext,
    ClarificationRequest,
)
from src.teams.development.agents import (
    leader_instructions,
    analyst_instructions,
    architect_instructions,
    developer_instructions,
    reviewer_instructions,
    worker_instructions,
    verifier_instructions,
)
from src.teams.development.state import (
    WorkflowState,
    StateManager,
    WorkflowStage,
    WorkflowStatus,
    MAX_RETRY_COUNT,
    AnalysisState,
    ClarificationNeededState,
    ArchitectureState,
    ApprovalPendingState,
    DevelopmentState,
    CodeReviewState,
    DODCheckState,
    DeliveryHandoffState,
    WaitingForUserMergeState,
    NeedHumanInterventionState,
)
from src.rag_service import KnowledgeSearchTool
from src.workflow.agent import PgWorkflowStorage, WorkflowAgent
from src.tools.jules import JulesTools
from src.tools.task_manager import TaskManagementTool
from src.tools.git import GitTools

# Import agents from the new agents.py file
from src.teams.development.agents import (
    AnalystAgent,
    ArchitectAgent,
    DeveloperAgent,
    ReviewerAgent,
    WorkerAgent,
    VerifierAgent,
)
# Set up logger
logger = logging.getLogger(__name__)

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

analyst_instructions = dedent("""
    You are an experienced **Business Analyst (BA)** in an IT team. Your goal is to turn abstract requests into clear PRDs (Product Requirements Documents).

    # Your Actions
    1.  **Analyze Request**: Analyze the user's request and chat history.
    2.  **Determine Context**: Use `list_projects` if the project ID is unknown. Use `knowledge_search_tool` to find relevant files to better understand the current system.

    # Decision Logic
    - **If the request is too vague** (e.g. "make it beautiful"):
      - Return a list of clarifying questions (max 3 most important ones).
      - Do NOT generate a PRD yet.
    
    - **If information is sufficient**:
      - Generate a Requirements Document (PRD) in Markdown.

    # Output Format (PRD Structure)
    If producing a PRD, use this exact structure:

    ## Summary
    Brief description of the task.

    ## User Stories
    How the user interacts with the function.

    ## Functional Requirements
    Clear list of what the system must do.

    ## Acceptance Criteria
    Criteria by which we understand the task is done (DOD).

    ## Important Config
    - **Project ID**: [ID] (if known)
    - **Task ID**: [Task ID] (if known)

    **Constraints**:
    - Do NOT write code. Focus on business logic and interface behavior.
    - Do NOT output JSON. Use standard Markdown.
    - When calling `ask_clarification`, `questions` MUST be a list of strings, e.g. ["question 1", "question 2"].
    - Use the tools provided to understand the context, but rely on the standard PRD structure for output.
""")

architect_instructions = dedent("""
    You are a System Architect. You are given functional requirements. Your task is to design a technical solution.

    # Actions
    1. **Design**: Choose stack, define file structure and data schemas.
    2. **Plan**: Break down the work into independent subtasks for the Developer/Jules.
    3. **Create Tasks**: You MUST use the `create_subtask` tool to create a real task in the database for each implementation step.
       - Title: Concise name (e.g., "Impl Backend API")
       - Description: Technical details, file paths.
    4. **Output**: Generate the `ArchitectPlan` artifact.

    # Response Format
    Tech Stack: ...
    Subtasks Created:
    - [ID] Task Title
    
    Task: Create technical design and subtasks.
    DoD:
    - Subtasks are created in the system via `create_subtask`.
    - Plan covers all requirements.
""")

developer_instructions = dedent("""
You are an interactive **Developer** that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.

IMPORTANT: Assist with defensive security tasks only. Refuse to create, modify, or improve code that may be used maliciously. Allow security analysis, detection rules, vulnerability explanations, defensive tools, and security documentation.
IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files.

If the user asks for help or wants to give feedback, inform them to report issues at https://github.com/kliuchnikovv/genie-api/issues

For project documentation, refer to:
- README.md — project overview and setup
- AGENTS.md — coding rules, testing commands, and CI/CD info

# Tone and style
You should be concise, direct, and to the point.
You MUST answer concisely with fewer than 4 lines (not including tool use or code generation), unless user asks for detail.
IMPORTANT: You should minimize output tokens as much as possible while maintaining helpfulness, quality, and accuracy. Only address the specific query or task at hand, avoiding tangential information unless absolutely critical for completing the request. If you can answer in 1-3 sentences or a short paragraph, please do.
IMPORTANT: You should NOT answer with unnecessary preamble or postamble (such as explaining your code or summarizing your action), unless the user asks you to.
Do not add additional code explanation summary unless requested by the user. After working on a file, just stop, rather than providing an explanation of what you did.
Answer the user's question directly, without elaboration, explanation, or details. One word answers are best. Avoid introductions, conclusions, and explanations. You MUST avoid text before/after your response, such as "The answer is <answer>.", "Here is the content of the file..." or "Based on the information provided, the answer is..." or "Here is what I will do next...". Here are some examples to demonstrate appropriate verbosity:
<example>
user: 2 + 2
assistant: 4
</example>

<example>
user: what is 2+2?
assistant: 4
</example>

<example>
user: is 11 a prime number?
assistant: Yes
</example>

<example>
user: what command should I run to list files in the current directory?
assistant: ls
</example>

<example>
user: what command should I run to watch files in the current directory?
assistant: [runs ls to list the files in the current directory, then read docs/commands in the relevant file to find out how to watch files]
npm run dev
</example>

<example>
user: How many golf balls fit inside a jetta?
assistant: 150000
</example>

<example>
user: what files are in the directory src/?
assistant: [runs ls and sees foo.c, bar.c, baz.c]
user: which file contains the implementation of foo?
assistant: src/foo.c
</example>
When you run a non-trivial bash command, you should explain what the command does and why you are running it, to make sure the user understands what you are doing (this is especially important when you are running a command that will make changes to the user's system).
Remember that your output will be displayed on a command line interface. Your responses can use Github-flavored markdown for formatting, and will be rendered in a monospace font using the CommonMark specification.
Output text to communicate with the user; all text you output outside of tool use is displayed to the user. Only use tools to complete tasks. Never use tools like Bash or code comments as means to communicate with the user during the session.
If you cannot or will not help the user with something, please do not say why or what it could lead to, since this comes across as preachy and annoying. Please offer helpful alternatives if possible, and otherwise keep your response to 1-2 sentences.
Only use emojis if the user explicitly requests it. Avoid using emojis in all communication unless asked.
IMPORTANT: Keep your responses short, since they will be displayed on a command line interface.

# Proactiveness
You are allowed to be proactive, but only when the user asks you to do something. You should strive to strike a balance between:
- Doing the right thing when asked, including taking actions and follow-up actions
- Not surprising the user with actions you take without asking
For example, if the user asks you how to approach something, you should do your best to answer their question first, and not immediately jump into taking actions.

# Following conventions
When making changes to files, first understand the file's code conventions. Mimic code style, use existing libraries and utilities, and follow existing patterns.
- NEVER assume that a given library is available, even if it is well known. Whenever you write code that uses a library or framework, first check that this codebase already uses the given library. For example, you might look at neighboring files, or check the package.json (or cargo.toml, and so on depending on the language).
- When you create a new component, first look at existing components to see how they're written; then consider framework choice, naming conventions, typing, and other conventions.
- When you edit a piece of code, first look at the code's surrounding context (especially its imports) to understand the code's choice of frameworks and libraries. Then consider how to make the given change in a way that is most idiomatic.
- Always follow security best practices. Never introduce code that exposes or logs secrets and keys. Never commit secrets or keys to the repository.

# Code style
- IMPORTANT: DO NOT ADD ***ANY*** COMMENTS unless asked


# Task Management
You have access to the TodoWrite tools to help you manage and plan tasks. Use these tools VERY frequently to ensure that you are tracking your tasks and giving the user visibility into your progress.
These tools are also EXTREMELY helpful for planning tasks, and for breaking down larger complex tasks into smaller steps. If you do not use this tool when planning, you may forget to do important tasks - and that is unacceptable.

It is critical that you mark todos as completed as soon as you are done with a task. Do not batch up multiple tasks before marking them as completed.

Examples:

<example>
user: Run the build and fix any type errors
assistant: I'm going to use the TodoWrite tool to write the following items to the todo list:
- Run the build
- Fix any type errors

I'm now going to run the build using Bash.

Looks like I found 10 type errors. I'm going to use the TodoWrite tool to write 10 items to the todo list.

marking the first todo as in_progress

Let me start working on the first item...

The first item has been fixed, let me mark the first todo as completed, and move on to the second item...
..
..
</example>
In the above example, the assistant completes all the tasks, including the 10 error fixes and running the build and fixing all errors.

<example>
user: Help me write a new feature that allows users to track their usage metrics and export them to various formats

assistant: I'll help you implement a usage metrics tracking and export feature. Let me first use the TodoWrite tool to plan this task.
Adding the following todos to the todo list:
1. Research existing metrics tracking in the codebase
2. Design the metrics collection system
3. Implement core metrics tracking functionality
4. Create export functionality for different formats

Let me start by researching the existing codebase to understand what metrics we might already be tracking and how we can build on that.

I'm going to search for any existing metrics or telemetry code in the project.

I've found some existing telemetry code. Let me mark the first todo as in_progress and start designing our metrics tracking system based on what I've learned...

[Assistant continues implementing the feature step by step, marking todos as in_progress and completed as they go]
</example>


Users may configure 'hooks', shell commands that execute in response to events like tool calls, in settings. Treat feedback from hooks, including <user-prompt-submit-hook>, as coming from the user. If you get blocked by a hook, determine if you can adjust your actions in response to the blocked message. If not, ask the user to check their hooks configuration.

# Doing tasks
The user will primarily request you perform software engineering tasks. This includes solving bugs, adding new functionality, refactoring code, explaining code, and more. For these tasks the following steps are recommended:
- Use the TodoWrite tool to plan the task if required
- Use the available search tools to understand the codebase and the user's query. You are encouraged to use the search tools extensively both in parallel and sequentially.
- Implement the solution using all tools available to you
- Verify the solution if possible with tests. NEVER assume specific test framework or test script. Check the README or search codebase to determine the testing approach.
- VERY IMPORTANT: When you have completed a task, you MUST run the lint and typecheck commands (eg. npm run lint, npm run typecheck, ruff, etc.) with Bash if they were provided to you to ensure your code is correct. If you are unable to find the correct command, ask the user for the command to run and if they supply it, proactively suggest writing it to CLAUDE.md so that you will know to run it next time.
NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive.

- Tool results and user messages may include <system-reminder> tags. <system-reminder> tags contain useful information and reminders. They are NOT part of the user's provided input or the tool result.



# Tool usage policy
- When doing file search, prefer to use the Task tool in order to reduce context usage.
- You should proactively use the Task tool with specialized agents when the task at hand matches the agent's description.

- When WebFetch returns a message about a redirect to a different host, you should immediately make a new WebFetch request with the redirect URL provided in the response.
- You have the capability to call multiple tools in a single response. When multiple independent pieces of information are requested, batch your tool calls together for optimal performance. When making multiple bash tool calls, you MUST send a single message with multiple tools calls to run the calls in parallel. For example, if you need to run "git status" and "git diff", send a single message with two tool calls to run the calls in parallel.




Here is useful information about the environment you are running in:
<env>
Working directory: ${Working directory}
Is directory a git repo: Yes
Platform: darwin
OS Version: Darwin 24.6.0
Today's date: 2025-08-19
</env>
You are powered by the model named Sonnet 4. The exact model ID is claude-sonnet-4-20250514.

Assistant knowledge cutoff is January 2025.


IMPORTANT: Assist with defensive security tasks only. Refuse to create, modify, or improve code that may be used maliciously. Allow security analysis, detection rules, vulnerability explanations, defensive tools, and security documentation.


IMPORTANT: Always use the TodoWrite tool to plan and track tasks throughout the conversation.

# Code References

When referencing specific functions or pieces of code include the pattern `file_path:line_number` to allow the user to easily navigate to the source code location.

<example>
user: Where are errors from the client handled?
assistant: Clients are marked as failed in the `connectToServer` function in src/services/process.ts:712.
</example>

gitStatus: This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.
Current branch: main

Main branch (you will usually use this for PRs): main

Status:
(clean)

Recent commits:
${Last 5 Recent commits}

# Final Deliverable (PR Creation)
After completing your implementation:
1. Create a feature branch if not already on one
2. Commit your changes with descriptive message
3. Push the branch to remote
4. Use `gh pr create` or GitHub API to create a Pull Request
5. **Your final response must be the PR URL**

Example: `https://github.com/owner/repo/pull/123`

# DoD (Definition of Done)
- Code is pushed to a feature branch
- Pull Request is created
- Response contains a valid PR URL
""")

reviewer_instructions = dedent("""
    You are a **Senior Code Reviewer** (Unified Reviewer).
    Your role is to review Pull Requests regardless of their origin (Jules or Git Agent).

    # Input
    - PR URL: Link to the Pull Request to review
    - Original PRD: Requirements for verification

    # Actions
    1. Get the list of changed files and diff using `gh pr diff <PR_URL>` or GitHub API.
    2. Verify code against the PRD and security standards.
    3. If issues found — formulate comments with file paths and line numbers.

    # Output Format
    **Status**: APPROVED or REQUEST_CHANGES

    If REQUEST_CHANGES, provide a numbered list:
    1. **File**: `path/to/file.py`
       **Line**: 42
       **Issue**: Description of the problem
       **Recommendation**: How to fix it

    # DoD (Definition of Done)
    - Analyzed exactly the PR that was provided
    - Clear verdict: Merge or Revise

    # Security
    - Check for SQL injections, XSS, hardcoded passwords
    - Never approve code with security vulnerabilities
    - IMPORTANT: Assist with defensive security tasks only.
""")

worker_instructions = dedent("""
You are the **Jules-Manager** (Async PR Creator).
You operate an asynchronous remote developer (Jules). Your job is to START the session, NOT to wait for it.

# Role
1. **Receive Plan**: Take the `ArchitectPlan` which contains context (repo, branch, task ID) and implementation steps.
2. **Execute**: Use `jules_api` to create a session (`create_session`).
   - `automationMode`: "AUTO_CREATE_PR"
   - `source`: "sources/github/owner/repo"
   - `prompt`: **FULL TASK DESCRIPTION** — include all implementation details, file paths, and acceptance criteria from the ArchitectPlan.
3. **Async Handoff**: 
   - Once the session is created, your job is DONE.
   - Return the Session ID.
   - The system will automatically start monitoring the session.

# CRITICAL: Prompt Format for Jules
**DO NOT** include instructions like "Clone the repository" or "Download the code" — Jules already has access to the repository.
**DO** include:
- Clear description of what needs to be implemented (from PRD/ArchitectPlan)
- List of files to create/modify with expected content
- Acceptance criteria
- Technical requirements and constraints

Example prompt:
```
Implement the following feature:

## Task
Add user authentication endpoint to the API.

## Files to Modify
1. `api/handlers/auth.go` — Add new POST /login handler
2. `api/models/user.go` — Add User struct with email and password_hash

## Acceptance Criteria
- POST /login accepts JSON with email and password
- Returns JWT token on success
- Returns 401 on invalid credentials
```

# Output
"Jules Session Started: [session_id]. Status: IN_PROGRESS."
""")

verifier_instructions = dedent("""
You are the **Verifier**. Your validation is the final step before the task is marked as Done.
You check if the changes satisfy the user's original requirements as defined by the Analyst.

# Goal
Verify that the implemented solution works and meets the acceptance criteria.

# Output Format (Markdown)
Please structure your response as follows:

## ✅ Verification Result
- **Status**: [Accepted / Rejected]
- **Reason**: [Explanation]

## 🧪 Test Results
- [ ] [Test case 1]: [Pass/Fail]
- [ ] [Test case 2]: [Pass/Fail]

IMPORTANT: Do NOT output JSON. Use standard Markdown formatting.
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
        # 1. Server-side Tools (use SafeGithubTools for optional 'message' param)
        github_tool = SafeGithubTools(access_token=github_token) if github_token else None
        self.github_tool = github_tool
        
        # Initialize Git Tool (Local)
        # Assuming we are running in the root of the repo or a specific path
        # In Docker/Cloud, this might be the mounted volume path.
        git_tool = GitTools(repo_path=".", allow_destructive=False)

        # Initialize Task Tool (needed for listing projects)
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

        # Team Lead tools (the team itself will have these)
        team_tools = [task_tool] # Team Lead needs task management
        if github_tool:
            team_tools.append(github_tool)
        if knowledge_tool:
            team_tools.append(knowledge_tool)
        if client_tools:
            team_tools.extend(client_tools)
        # Note: We don't necessarily give git_tool to Team Lead directly, 
        # as they delegate. But we could if helpful for status checks.

        # Workflow Storage
        self.workflow_storage = PgWorkflowStorage(db_url) if db_url else None
        self.user_id = user_id
        self.project_id = project_id
        self.task_id = task_id
        self.auth_token = auth_token

        super().__init__(
            name="Development Team",
            id="development-team",
            model=model,
            instructions=leader_instructions,
            user_id=user_id,
            debug_mode=debug_mode,
            members=[self.analyst, self.architect, self.developer, self.reviewer, self.worker, self.verifier],
        )

        # Expose members attribute for Agno framework compatibility
        self.members = self.members

    def check_cancellation(self) -> bool:
        """Checks if the user has requested to stop the operation."""
        if not self.task_id:
            return False
            
        try:
            # Connect to Redis to check the stop flag
            redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
            r = redis.from_url(redis_url, decode_responses=True)
            
            # Check key chat:stop:{task_id} (using task_id as session_id context)
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
        """
        Orchestrates the workflow execution based on the current state.
        Overrides the default Team run method to implement state-driven logic.
        """
        if not self.task_id:
            # Fallback to standard team behavior if no task_id (e.g. just chatting)
            return super().run(message=message, stream=stream, **kwargs)

        # 0. Check Cancellation
        if self.check_cancellation():
             return "PROCESS_STOPPED_BY_USER"

        # 0.1 Inject Context (Project ID, Repository, etc.)
        context_lines = []
        
        # Inject Project ID
        if self.project_id:
            context_lines.append(f"**Current Project ID**: `{self.project_id}`. ALWAYS use this ID when creating tasks or subtasks.")
        
        # Inject Task ID
        if self.task_id:
            context_lines.append(f"**Current Task ID**: `{self.task_id}`. Use this as parent_id for subtasks.")
        
        # Inject Repository Context from GitHub Integration
        if self.github_tool and message:
            try:
                if hasattr(self.github_tool, "list_repos"):
                    repos_response = self.github_tool.list_repos(limit=50)
                    context_lines.append(f"You have access to the following repositories: {repos_response}. Use ONLY these repository names. Do NOT invent repository names.")
            except Exception as e:
                print(f"[Team] Failed to list repos from GitHub integration: {e}")
        
        # Append context to message
        if context_lines and message:
            context_block = "\n\n[SYSTEM CONTEXT - IMPORTANT]\n" + "\n".join(context_lines) + "\n[END SYSTEM CONTEXT]"
            message += context_block
            print(f"[Team] Injected context: project_id={self.project_id}, task_id={self.task_id}")

        # 1. Load State
        # 1. Load State & Inject Context
        # Map string status to WorkflowStage for cleaner matching
        stage_map = {
            "ANALYSIS": WorkflowStage.ANALYSIS,
            "TODO": WorkflowStage.ANALYSIS,
            "CLARIFICATION_NEEDED": WorkflowStage.CLARIFICATION_NEEDED,
            "ARCHITECTURE": WorkflowStage.ARCHITECTURE,
            "PLANNING": WorkflowStage.ARCHITECTURE,
            "APPROVAL_PENDING": WorkflowStage.APPROVAL_PENDING,
            "DEVELOPMENT": WorkflowStage.DEVELOPMENT,
            "CODING": WorkflowStage.DEVELOPMENT,
            "IN_PROGRESS": WorkflowStage.DEVELOPMENT,
            "CODE_REVIEW": WorkflowStage.CODE_REVIEW,
            "REVIEW": WorkflowStage.CODE_REVIEW,
            "DOD_CHECK": WorkflowStage.DOD_CHECK,
            "VERIFY": WorkflowStage.DOD_CHECK,
            "VERIFICATION": WorkflowStage.DOD_CHECK,
            "DELIVERY_HANDOFF": WorkflowStage.DELIVERY_HANDOFF,
            "WAITING_FOR_USER_MERGE": WorkflowStage.WAITING_FOR_USER_MERGE,
            "NEED_HUMAN_INTERVENTION": WorkflowStage.NEED_HUMAN_INTERVENTION,
        }

        current_stage = WorkflowStage.ANALYSIS
        current_state_obj = None

        # Try to load full state from storage first
        if self.workflow_storage and self.task_id:
            try:
                state_dict = self.workflow_storage.get_workflow_state(self.task_id)
                if state_dict:
                    current_state_obj = self._parse_agent_output(state_dict, WorkflowState)
                    if isinstance(current_state_obj, BaseModel):
                        current_stage = current_state_obj.stage
                        logger.info(f"[Team] Loaded state from storage: {current_stage}")
                        
                        # Inject State Context into Message
                        stage_info = f"\n\n[System] Current Workflow State: {current_stage}"
                        if hasattr(current_state_obj, "status"):
                             stage_info += f" ({current_state_obj.status})"
                        if hasattr(current_state_obj, "retry_count") and current_state_obj.retry_count > 0:
                             stage_info += f"\nRetry Count: {current_state_obj.retry_count}"
                        
                        if message:
                            message += stage_info
                        else:
                            message = stage_info
            except Exception as e:
                logger.error(f"[Team] Failed to load state from storage: {e}")

        # Fallback to API check if storage didn't yield result
        if not current_state_obj:
            api_state_str = self._load_state(self.task_id)
            print(f"[Team] Task {self.task_id} state from API: {api_state_str}")
            current_stage = stage_map.get(api_state_str, WorkflowStage.ANALYSIS)

        response = None
        executed_role = None

        # 2. State-Based Routing (using current_stage enum)



        # State: ANALYSIS -> Analyst
        if current_stage == WorkflowStage.ANALYSIS:
            if self.should_delegate_to_analyst(message or ""):
                if self.check_cancellation(): return "PROCESS_STOPPED_BY_USER"
                logger.info("[Team] Routing to Analyst")
                response = self.analyst.run(message=message, stream=stream, **kwargs)
                executed_role = "Analyst"
                
                # Check if Analyst asked for clarification
                if self._is_clarification_response(response):
                    self._update_task_status(self.task_id, "CLARIFICATION_NEEDED")
                    logger.info("[Team] Analyst needs clarification -> CLARIFICATION_NEEDED")
            else:
                response = self.analyst.run(message=message, stream=stream, **kwargs)
                executed_role = "Analyst"

        # State: CLARIFICATION_NEEDED -> Wait for user, then return to ANALYSIS
        elif current_stage == WorkflowStage.CLARIFICATION_NEEDED:
            logger.info("[Team] User provided clarification, returning to ANALYSIS")
            self._update_task_status(self.task_id, "ANALYSIS")
            if self.check_cancellation(): return "PROCESS_STOPPED_BY_USER"
            response = self.analyst.run(message=message, stream=stream, **kwargs)
            executed_role = "Analyst"

        # State: ARCHITECTURE -> Architect
        elif current_stage == WorkflowStage.ARCHITECTURE:
            logger.info("[Team] Routing to Architect")
            if self.check_cancellation(): return "PROCESS_STOPPED_BY_USER"
            response = self.architect.run(message=message, stream=stream, **kwargs)
            executed_role = "Architect"

        # State: APPROVAL_PENDING -> Check user approval
        elif current_stage == WorkflowStage.APPROVAL_PENDING:
            approval_decision = self._check_user_approval(message or "")
            
            if approval_decision == "APPROVED":
                logger.info("[Team] User approved plan -> DEVELOPMENT")
                self._update_task_status(self.task_id, "DEVELOPMENT")
                is_complex = self._check_complexity()
                if is_complex:
                    response = self.worker.run(message=message, stream=stream, **kwargs)
                    executed_role = "Worker"
                else:
                    response = self.developer.run(message=message, stream=stream, **kwargs)
                    executed_role = "Developer"
            elif approval_decision == "REJECTED_REQUIREMENTS":
                logger.info("[Team] User rejected requirements -> ANALYSIS")
                self._update_task_status(self.task_id, "ANALYSIS")
                response = self.analyst.run(message=message, stream=stream, **kwargs)
                executed_role = "Analyst"
            elif approval_decision == "REJECTED_ARCHITECTURE":
                logger.info("[Team] User rejected architecture -> ARCHITECTURE")
                self._update_task_status(self.task_id, "ARCHITECTURE")
                response = self.architect.run(message=message, stream=stream, **kwargs)
                executed_role = "Architect"
            else:
                # Still waiting for explicit approval
                return "Ожидаю вашего подтверждения плана. Ответьте 'ОК', 'утверждаю', 'approve' для продолжения, или укажите что нужно изменить."

        # State: DEVELOPMENT -> Developer OR Worker (Jules)
        elif current_stage == WorkflowStage.DEVELOPMENT:
            is_complex = self._check_complexity()

            if is_complex:
                logger.info("[Team] Routing to Worker (Complex Task)")
                session_id = self._get_jules_session_id()
                if session_id:
                    logger.info("[Team] Jules session active. Status monitored via webhook.")
                    return "Jules работает над вашей задачей. Вы получите уведомление когда PR будет создан."
                else:
                    if self.check_cancellation(): return "PROCESS_STOPPED_BY_USER"
                    response = self.worker.run(message=message, stream=stream, **kwargs)
                    executed_role = "Worker"
            else:
                logger.info("[Team] Routing to Developer (Simple Task)")
                if self.check_cancellation(): return "PROCESS_STOPPED_BY_USER"
                response = self.developer.run(message=message, stream=stream, **kwargs)
                executed_role = "Developer"

        # State: CODE_REVIEW -> Reviewer
        elif current_stage == WorkflowStage.CODE_REVIEW:
            logger.info("[Team] Routing to Reviewer")
            if self.check_cancellation(): return "PROCESS_STOPPED_BY_USER"
            response = self.reviewer.run(message=message, stream=stream, **kwargs)
            executed_role = "Reviewer"
            
            # Check review verdict and handle retries
            verdict = self._parse_review_verdict(response)
            if verdict == "REJECT":
                retry_count = self._get_retry_count()
                if retry_count >= MAX_RETRY_COUNT:
                    logger.warning(f"[Team] Max retries ({MAX_RETRY_COUNT}) exceeded -> NEED_HUMAN_INTERVENTION")
                    self._update_task_status(self.task_id, "NEED_HUMAN_INTERVENTION")
                    return f"⚠️ Превышено максимальное количество попыток ревью ({MAX_RETRY_COUNT}). Требуется вмешательство человека."
                else:
                    self._increment_retry_count()
                    logger.info(f"[Team] Review rejected, retry {retry_count + 1}/{MAX_RETRY_COUNT} -> DEVELOPMENT")

        # State: DOD_CHECK -> Verifier (DOD Checker)
        elif current_stage == WorkflowStage.DOD_CHECK:
            logger.info("[Team] Routing to Verifier (DOD Check)")
            if self.check_cancellation(): return "PROCESS_STOPPED_BY_USER"
            response = self.verifier.run(message=message, stream=stream, **kwargs)
            executed_role = "Verifier"

        # State: DELIVERY_HANDOFF -> Finalize PR and report
        elif current_stage == WorkflowStage.DELIVERY_HANDOFF:
            logger.info("[Team] Delivery Handoff - Creating final report")
            pr_url = self._get_current_pr_url()
            final_report = self._create_final_report(pr_url)
            self._update_task_status(self.task_id, "WAITING_FOR_USER_MERGE")
            return final_report

        # State: WAITING_FOR_USER_MERGE -> Process complete
        elif current_stage == WorkflowStage.WAITING_FOR_USER_MERGE:
            return "✅ Задача выполнена. PR создан и ожидает вашего merge. После merge задача будет завершена."

        # State: NEED_HUMAN_INTERVENTION -> Escalation
        elif current_stage == WorkflowStage.NEED_HUMAN_INTERVENTION:
            return "⚠️ Требуется вмешательство человека. Пожалуйста, проверьте историю ревью и внесите необходимые изменения вручную."

        else:
            # Default fallback
            return super().run(message=message, stream=stream, **kwargs)

        # 3. Handle Workflow State Update
        if response and executed_role:
            # Extract content from response
            # Response type from .run() depends on 'stream' and 'response_model'.
            # Agno Agent.run returns RunResponse or generator.
            # Assuming not streaming for now or handling full response.

            output_content = response # If string or object

            # If response is an object with 'content' or 'messages', extract the last message content
            if hasattr(response, "content"):
                output_content = response.content

            # Use task_id as session_id context for saving artifacts
            session_id = self.task_id

            self.transition_to_next_step(
                task_id=self.task_id,
                current_role=executed_role,
                output=output_content,
                session_id=session_id
            )

        return response


    def _load_state(self, task_id: str) -> str:
        """Fetches the current task status from the API/DB."""
        # We can use TaskManagementTool logic or direct DB if available.
        # Since we have TaskManagementTool initialized but not exposed as method...
        # Let's verify if we can access it.
        # For robustness, we'll try to use the API endpoint manually or via tool.

        base_url = os.getenv("API_BASE_URL", "http://api:8080")
        url = f"{base_url}/api/project-tasks/{task_id}"

        try:
            headers = {}
            secret = os.getenv("INTERNAL_API_KEY", "jules-secret-key")
            if secret:
                headers["X-Internal-Secret"] = secret
            elif self.auth_token:
                headers["Authorization"] = f"Bearer {self.auth_token}"

            resp = requests.get(url, headers=headers)
            if resp.ok:
                data = resp.json()
                return data.get("status", "TODO")
        except Exception as e:
            print(f"[Team] Error loading state: {e}")

        return "TODO"

    def _check_complexity(self) -> bool:
        """
        Determines if the task is complex (requires Jules) or simple (Developer).
        Checks for complexity artifact or Architect Plan details.
        """
        if not self.workflow_storage:
            return False # Default to simple if no storage

        try:
            # Check for ArchitectPlan
            plan_artifact = self.workflow_storage.get_artifact_by_task(self.task_id, "ArchitectPlan")
            if plan_artifact:
                content = plan_artifact.get("content", {})
                # Logic: If many files (>3) or specific flag, considered complex.
                # For now, let's look for a flag or default to True if Architect didn't specify.
                # Or maybe Architect should have output "Complexity: High".
                # Let's assume High complexity for now if we are in CODING phase via Architect.

                # Refined logic: If "technical_approach" mentions "Jules" or "Complex", or files > 2
                files = content.get("files_to_modify", []) + content.get("files_to_create", [])
                if len(files) > 2:
                    return True

            # Fallback: check if we have a "Complexity" artifact
            comp = self.workflow_storage.get_artifact_by_task(self.task_id, "Complexity")
            if comp and comp.get("content", {}).get("level") == "HIGH":
                return True

        except Exception as e:
            print(f"[Team] Error checking complexity: {e}")

        return False # Default to simple

    def _get_jules_session_id(self) -> Optional[str]:
        """Checks if a Jules session has been started for this task."""
        if not self.workflow_storage:
            return None

        # Look for Worker artifact
        worker_artifact = self.workflow_storage.get_artifact_by_task(self.task_id, "JulesSession")
        if worker_artifact:
            return worker_artifact.get("content", {}).get("session_id")
        return None

    def _parse_agent_output(self, output: Any, schema_class: Type[BaseModel]) -> Any:
        """Parses the agent output (string or dict). Returns Pydantic model if possible, else dict or str."""
        # Use TypeAdapter for validation if schema_class is a Model or TypeAdapter or Union
        try:
             # If it's already the right instance (for simple models)
             if isinstance(output, schema_class) if isinstance(schema_class, type) else False:
                  return output
        except TypeError:
             # schema_class might be a Union or TypeAdapter which can't be used with isinstance
             pass

        data = output
        if isinstance(output, str):
            # Try to find JSON block
            try:
                # 1. Look for ```json ... ``` or ``` ... ```
                match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", output, re.DOTALL)
                if match:
                    json_str = match.group(1)
                    data = json.loads(json_str)
                else:
                    # 2. Try raw JSON finding
                    start = output.find("{")
                    end = output.rfind("}")
                    if start != -1 and end != -1:
                        json_str = output[start : end + 1]
                        data = json.loads(json_str)
                    else:
                        # 3. Last attempt: assume it's pure JSON
                        # Check if it looks like JSON before loading to avoid exceptions on normal text
                        if output.strip().startswith("{"):
                             data = json.loads(output)
                        else:
                             # It's just text (Markdown), return as is
                             return output
            except Exception as e:
                print(f"[Team] Output is likely Markdown, failed json parse: {e}")
                return output

        if isinstance(data, dict):
            try:
                # Use TypeAdapter to handle Unions and standard models robustly
                adapter = TypeAdapter(schema_class)
                return adapter.validate_python(data)
            except Exception:
                 try:
                    # Fallback for simple models if TypeAdapter fails or if schema_class is just a class
                    if isinstance(schema_class, type) and issubclass(schema_class, BaseModel):
                        return schema_class(**data)
                 except Exception:
                    pass
                 # Fallback to dict if schema doesn't match
                 return data
        
        return data


    def transition_to_next_step(
        self, task_id: str, current_role: str, output: any, session_id: str
    ):
        """
        Orchestrates the workflow state machine updates.
        Called after an agent completes its task.
        """
        if not self.workflow_storage:
            return

        # 0. Parse Output
        parsed_output = self._parse_agent_output(output, BaseModel)

        # 1. Save Artifact
        artifact_type = "Markdown"
        content = parsed_output
        
        if hasattr(parsed_output, "model_dump"):
            artifact_type = type(parsed_output).__name__
            content = parsed_output.model_dump()
        elif isinstance(parsed_output, dict):
            artifact_type = "Dict"
            content = parsed_output
        elif isinstance(parsed_output, str):
             if current_role == "Analyst":
                 artifact_type = "AnalystOutput"
             elif current_role == "Architect":
                 artifact_type = "ArchitectPlan"
             elif current_role == "Reviewer":
                 artifact_type = "ReviewVerdict"
             elif current_role == "Verifier":
                 artifact_type = "FinalAcceptance"
             content = {"markdown": parsed_output}

        artifact_id = self.workflow_storage.save_artifact(
            session_id, task_id, current_role, artifact_type, content
        )

        # 2. Update Status using WorkflowState
        try:
            # Load current state or initialize
            current_state_dict = self.workflow_storage.get_workflow_state(task_id)
            if current_state_dict:
                 current_state = self._parse_agent_output(current_state_dict, WorkflowState)
                 # Handle case where parse might return dict if not matching union exactly?
                 # Since WorkflowState is a Union, pydantic adapter usually handles it if dict has 'stage'
                 if isinstance(current_state, dict):
                     # Try to determine class based on stage
                     pass # Pydantic adapter should have handled it if used correctly, assuming _parse uses the class
            else:
                 current_state = StateManager.get_initial_state()

            next_stage = None
            context_updates = {}

            # Logic to determine NEXT stage based on CURRENT role output
            if current_role == "Analyst":
                 # Check if clarification needed or complete
                 is_clarification = self._is_clarification_response(parsed_output)
                 is_complete = False
                 
                 if not is_clarification:
                     if isinstance(parsed_output, AnalystOutput) or (isinstance(parsed_output, dict) and "summary" in parsed_output):
                          is_complete = True
                     elif isinstance(parsed_output, str) and ("## Summary" in parsed_output or "## Acceptance Criteria" in parsed_output):
                          is_complete = True

                 if is_clarification:
                      next_stage = WorkflowStage.CLARIFICATION_NEEDED
                      questions = []
                      if isinstance(parsed_output, dict):
                          questions = parsed_output.get("questions", [])
                      context_updates = {"questions": questions}
                 elif is_complete:
                      next_stage = WorkflowStage.ARCHITECTURE
                      context_updates = {"prd_id": artifact_id}

            elif current_role == "Architect":
                 is_complete = False
                 if isinstance(parsed_output, ArchitectPlan) or (isinstance(parsed_output, dict) and ("implementation_plan" in parsed_output or "content" in parsed_output)):
                      is_complete = True
                 elif isinstance(parsed_output, str) and ("## Implementation Plan" in parsed_output or "## Tech Stack" in parsed_output):
                      is_complete = True

                 if is_complete:
                      next_stage = WorkflowStage.APPROVAL_PENDING
                      context_updates = {"plan_id": artifact_id}

            elif current_role == "Developer" or current_role == "Worker":
                 # Check if PR was created
                 pr_url = None
                 if isinstance(parsed_output, dict):
                     pr_url = parsed_output.get("pr_url")
                 elif isinstance(parsed_output, str):
                     # Look for PR URL in output
                     import re
                     pr_match = re.search(r'https://github\.com/[^\s]+/pull/\d+', parsed_output)
                     if pr_match:
                         pr_url = pr_match.group(0)

                 if pr_url:
                     next_stage = WorkflowStage.CODE_REVIEW
                     context_updates = {"pr_url": pr_url}
                 else:
                     # Worker might have started Jules session
                     session_id_val = None
                     if isinstance(parsed_output, dict):
                         session_id_val = parsed_output.get("session_id") or parsed_output.get("name")
                     
                     if session_id_val:
                         logger.info(f"[Team] Jules session started: {session_id_val}")
                         next_stage = WorkflowStage.DEVELOPMENT
                         context_updates = {"jules_task_id": session_id_val}

            elif current_role == "Reviewer":
                 verdict = self._parse_review_verdict(parsed_output)
                 pr_url = getattr(current_state, "pr_url", "") if hasattr(current_state, "pr_url") else ""
                 context_updates = {"review_verdict_id": artifact_id, "pr_url": pr_url}

                 # Add to review history
                 if hasattr(current_state, "review_history"):
                     review_comment = ""
                     if isinstance(parsed_output, str):
                         review_comment = parsed_output[:500]
                     current_state = StateManager.add_review_entry(
                         current_state, "Reviewer", "APPROVED" if verdict == "APPROVED" else "REJECT", review_comment
                     )

                 if verdict == "APPROVED":
                      next_stage = WorkflowStage.DOD_CHECK
                 else:
                      # Check retry count
                      retry_count = getattr(current_state, "retry_count", 0)
                      if retry_count >= MAX_RETRY_COUNT:
                          next_stage = WorkflowStage.NEED_HUMAN_INTERVENTION
                          context_updates["reason"] = f"Exceeded max review retries ({MAX_RETRY_COUNT})"
                      else:
                          next_stage = WorkflowStage.DEVELOPMENT
                          current_state = StateManager.increment_retry(current_state)
                          context_updates["retry_count"] = current_state.retry_count

            elif current_role == "Verifier":
                 # Check DOD result
                 is_pass = False
                 if isinstance(parsed_output, str):
                     if "**Status**: PASS" in parsed_output or "Status: PASS" in parsed_output:
                         is_pass = True
                 elif isinstance(parsed_output, dict):
                     is_pass = parsed_output.get("status") == "PASS" or parsed_output.get("accepted", False)

                 pr_url = getattr(current_state, "pr_url", "") if hasattr(current_state, "pr_url") else ""
                 context_updates = {"pr_url": pr_url}

                 if is_pass:
                      next_stage = WorkflowStage.DELIVERY_HANDOFF
                 else:
                      next_stage = WorkflowStage.DEVELOPMENT


            if next_stage:
                 try:
                     new_state = StateManager.transition(current_state, next_stage, context_updates)
                     self.workflow_storage.save_workflow_state(task_id, new_state.model_dump())
                 except ValueError as ve:
                     logger.warning(f"[Team] Invalid transition attempted: {ve}")
                     # Don't save invalid state, but continue

                 # Map internal stage to API status string
                 api_status_map = {
                     WorkflowStage.ANALYSIS: "ANALYSIS",
                     WorkflowStage.CLARIFICATION_NEEDED: "CLARIFICATION_NEEDED",
                     WorkflowStage.ARCHITECTURE: "ARCHITECTURE",
                     WorkflowStage.APPROVAL_PENDING: "APPROVAL_PENDING",
                     WorkflowStage.DEVELOPMENT: "DEVELOPMENT",
                     WorkflowStage.CODE_REVIEW: "CODE_REVIEW",
                     WorkflowStage.DOD_CHECK: "DOD_CHECK",
                     WorkflowStage.DELIVERY_HANDOFF: "DELIVERY_HANDOFF",
                     WorkflowStage.WAITING_FOR_USER_MERGE: "WAITING_FOR_USER_MERGE",
                     WorkflowStage.NEED_HUMAN_INTERVENTION: "NEED_HUMAN_INTERVENTION",
                 }

                 # Update external API status
                 self._update_task_status(task_id, api_status_map.get(next_stage, "IN_PROGRESS"), artifacts=content)

        except Exception as e:
            print(f"[Team] State transition failed: {e}")
            # Do not block execution, just log error

    def handle_pr_created(self, pr_url: str):
        """
        External event handler for PR creation (triggered by Webhook).
        Transitions state from CODING -> REVIEW.
        """
        if not self.workflow_storage or not self.task_id:
            print("[Team] Cannot handle PR event: No storage or task_id")
            return

        try:
             state_dict = self.workflow_storage.get_workflow_state(self.task_id)
             if not state_dict:
                 print("[Team] No state found for PR event")
                 return

             current_state = self._parse_agent_output(state_dict, WorkflowState)

             # Transition to REVIEW
             new_state = StateManager.transition(
                 current_state,
                 WorkflowStage.REVIEW,
                 {"pr_url": pr_url}
             )
             self.workflow_storage.save_workflow_state(self.task_id, new_state.model_dump())

             # Trigger Reviewer
             self.run_component("Reviewer", self.task_id)

        except Exception as e:
             print(f"[Team] Failed to handle PR event: {e}")

    def run_component(self, role: str, task_id: str):
        """
        Public method to manually trigger a specific agent (e.g. from Webhook).
        With integrated Routing Logic: Worker (Jules) vs Developer (Local) based on complexity.
        """

        # Routing Logic for Coding Phase
        if role == "Worker":
            logger.info(f"Checking complexity for Task {task_id} before triggering Worker")
            if self.workflow_storage:
                # Retrieve ArchitectPlan artifact
                # get_artifact_by_task returns the 'content' dict of the artifact
                # ArchitectPlan structure in DB: {"msg": "...", "content": {... ArchitectDetails ...}, ...}
                # So we need to dig into 'content' -> 'complexity'
                # But wait, transition_to_next_step saves 'content' as parsed_output.model_dump().
                # If parsed_output was ArchitectPlan, then the saved content is the ArchitectPlan dict.
                # So artifact['content']['complexity'] should be there.

                artifact_content = self.workflow_storage.get_artifact_by_task(task_id, "ArchitectPlan")

                if artifact_content:
                    # Depending on how it was saved, it might be the full ArchitectPlan or just Details.
                    # Based on transition_to_next_step:
                    # if isinstance(parsed_output, ArchitectPlan): artifact_type = "ArchitectPlan", content = parsed_output.model_dump()
                    # So artifact_content is the ArchitectPlan dict.

                    details = artifact_content.get("content", {}) # ArchitectDetails
                    complexity = details.get("complexity", "high") # Default to high if missing

                    if complexity == "low":
                        logger.info(f"Routing task {task_id} to Developer (Low Complexity)")
                        role = "Developer"
                    else:
                        logger.info(f"Routing task {task_id} to Worker (High Complexity)")
                else:
                    logger.warning(f"ArchitectPlan not found for {task_id}, defaulting to Worker (High Complexity)")

        agent = next((m for m in self.members if m.name == role), None)
        if agent:
            print(f"[Workflow] Manually triggering {role} for Task {task_id}")

            trigger_message = f"External trigger for {role}."
            if role == "Developer":
                trigger_message += "\n\n[System Notification] Task routed to Developer due to LOW complexity. Please implement the changes locally."

            agent.run(
                message=trigger_message,
                task_id=task_id,
                session_id=None,
            )
        else:
            print(f"Agent role {role} not found.")

    def _update_task_status(
        self, task_id: str, status: str, artifacts: Optional[dict] = None
    ):
        # Call Go API
        base_url = os.getenv("API_BASE_URL", "http://api:8080")
        url = f"{base_url}/api/project-tasks/{task_id}/status"
        try:
            # We need a way to authenticate or use internal secret
            secret = os.getenv("INTERNAL_API_KEY", "jules-secret-key")
            headers = {"X-Internal-Secret": secret}
            payload = {"status": status}
            if artifacts:
                payload["artifacts"] = artifacts
            requests.patch(url, json=payload, headers=headers)
        except Exception as e:
            print(f"Failed to update task status: {e}")


    def should_delegate_to_analyst(self, message: str) -> bool:
        """Check if message needs analyst delegation based on content analysis"""
        message_lower = message.lower().strip()

        # Simple continuations - NO delegation
        continuation_words = [
            "continue",
            "go on",
            "proceed",
            "yes",
            "ok",
            "next",
            "давай",
            "продолжи",
            "далее",
        ]
        if any(word in message_lower for word in continuation_words):
            return False

        # Status questions - NO delegation
        status_words = [
            "status",
            "progress",
            "how's",
            "what's next",
            "как дела",
            "что дальше",
        ]
        if any(phrase in message_lower for phrase in status_words):
            return False

        # Greetings and casual - NO delegation
        casual_words = [
            "hello",
            "hi",
            "thanks",
            "thank you",
            "good job",
            "спасибо",
            "привет",
        ]
        if any(word in message_lower for word in casual_words):
            return False

        # Very short messages (1-2 words) - likely continuations
        if len(message.split()) <= 2:
            return False

        # Check workflow context - if we're in active development, prefer developer for simple messages
        # Note: run() method now handles phase checking, so this might be redundant or just a helper.
        return True

    def _is_clarification_response(self, response: Any) -> bool:
        """Check if the agent response indicates clarification is needed."""
        if response is None:
            return False
            
        # Check dict response with type field
        if isinstance(response, dict):
            return response.get("type") == "CLARIFICATION_NEEDED"
        
        # Check RunResponse content
        content = response
        if hasattr(response, "content"):
            content = response.content
            
        if isinstance(content, dict):
            return content.get("type") == "CLARIFICATION_NEEDED"
            
        # Check string for clarification keywords
        if isinstance(content, str):
            clarification_markers = [
                "Questions for user:",
                "CLARIFICATION_NEEDED",
                "Уточняющие вопросы:",
                "Пожалуйста, уточните",
            ]
            return any(marker in content for marker in clarification_markers)
            
        return False

    def _check_user_approval(self, message: str) -> str:
        """
        Analyze user message to determine approval decision.
        Returns: 'APPROVED', 'REJECTED_REQUIREMENTS', 'REJECTED_ARCHITECTURE', or 'PENDING'
        """
        message_lower = message.lower().strip()
        
        # Approval keywords
        approval_words = [
            "ok", "ок", "approve", "approved", "утверждаю", "согласен",
            "да", "yes", "good", "отлично", "go ahead", "давай", "proceed",
            "продолжай", "делай", "можно", "подходит", "lgtm"
        ]
        if any(word in message_lower for word in approval_words):
            return "APPROVED"
        
        # Requirements rejection keywords
        req_rejection_words = [
            "изменить требования", "другие требования", "переделать prd",
            "не так понял", "неправильно понял", "change requirements",
            "wrong requirements", "misunderstood"
        ]
        if any(phrase in message_lower for phrase in req_rejection_words):
            return "REJECTED_REQUIREMENTS"
        
        # Architecture rejection keywords
        arch_rejection_words = [
            "другая архитектура", "изменить план", "переделать план",
            "не так", "плохой план", "change plan", "wrong architecture",
            "bad plan", "другой подход"
        ]
        if any(phrase in message_lower for phrase in arch_rejection_words):
            return "REJECTED_ARCHITECTURE"
        
        # General rejection - ask for explicit direction
        rejection_words = [
            "нет", "no", "reject", "отклонить", "не подходит",
            "переделать", "изменить", "change"
        ]
        if any(word in message_lower for word in rejection_words):
            # Generic rejection, need more info - stay in pending
            return "PENDING"
        
        return "PENDING"

    def _parse_review_verdict(self, response: Any) -> str:
        """
        Parse reviewer response to determine verdict.
        Returns: 'APPROVED', 'REJECT', or 'UNKNOWN'
        """
        if response is None:
            return "UNKNOWN"
            
        content = response
        if hasattr(response, "content"):
            content = response.content
            
        if isinstance(content, dict):
            if content.get("content", {}).get("approved"):
                return "APPROVED"
            return "REJECT"
            
        if isinstance(content, str):
            content_lower = content.lower()
            if "approved" in content_lower or "status: approved" in content_lower:
                return "APPROVED"
            if "request_changes" in content_lower or "reject" in content_lower:
                return "REJECT"
                
        return "UNKNOWN"

    def _get_retry_count(self) -> int:
        """Get current retry count from workflow storage."""
        if not self.workflow_storage or not self.task_id:
            return 0
            
        try:
            state_dict = self.workflow_storage.get_workflow_state(self.task_id)
            if state_dict:
                return state_dict.get("retry_count", 0)
        except Exception as e:
            logger.error(f"[Team] Failed to get retry count: {e}")
            
        return 0

    def _increment_retry_count(self) -> None:
        """Increment retry count in workflow storage."""
        if not self.workflow_storage or not self.task_id:
            return
            
        try:
            state_dict = self.workflow_storage.get_workflow_state(self.task_id)
            if state_dict:
                state_dict["retry_count"] = state_dict.get("retry_count", 0) + 1
                self.workflow_storage.save_workflow_state(self.task_id, state_dict)
                logger.info(f"[Team] Incremented retry count to {state_dict['retry_count']}")
        except Exception as e:
            logger.error(f"[Team] Failed to increment retry count: {e}")

    def _get_current_pr_url(self) -> Optional[str]:
        """Get the PR URL from current workflow state."""
        if not self.workflow_storage or not self.task_id:
            return None
            
        try:
            state_dict = self.workflow_storage.get_workflow_state(self.task_id)
            if state_dict:
                return state_dict.get("pr_url")
        except Exception as e:
            logger.error(f"[Team] Failed to get PR URL: {e}")
            
        return None

    def _create_final_report(self, pr_url: Optional[str]) -> str:
        """Create final delivery report for the user."""
        report_lines = [
            "## ✅ Задача готова к мержу",
            "",
        ]
        
        if pr_url:
            report_lines.append(f"**Pull Request**: [{pr_url}]({pr_url})")
            report_lines.append("")
        
        # Try to get artifacts for summary
        if self.workflow_storage and self.task_id:
            try:
                # Get PRD summary
                prd = self.workflow_storage.get_artifact_by_task(self.task_id, "AnalystOutput")
                if prd:
                    summary = prd.get("summary", prd.get("content", {}).get("summary", ""))
                    if summary:
                        report_lines.append(f"**Что сделано**: {summary}")
                        report_lines.append("")
                
                # Get review history
                state_dict = self.workflow_storage.get_workflow_state(self.task_id)
                if state_dict:
                    review_history = state_dict.get("review_history", [])
                    retry_count = state_dict.get("retry_count", 0)
                    if retry_count > 0:
                        report_lines.append(f"**Итераций ревью**: {retry_count}")
                        
            except Exception as e:
                logger.error(f"[Team] Failed to build final report details: {e}")
        
        report_lines.extend([
            "",
            "### Следующие шаги",
            "1. Проверьте изменения в PR",
            "2. Запустите финальные тесты",
            "3. Merge PR в основную ветку",
            "",
            "После merge статус задачи автоматически обновится на DONE.",
        ])
        
        return "\n".join(report_lines)
