from textwrap import dedent
from typing import Optional, List, Any, Type
import os
import re
import json
from pydantic import BaseModel

from agno.agent import Agent
from agno.knowledge import Knowledge
from agno.db import BaseDb
from agno.models.base import Model
from agno.team import Team
from agno.tools import Toolkit
from agno.tools.github import GithubTools
import requests

from src.agents.genie import GenieAgent
from src.teams.development.models import (
    AnalystOutput,
    ArchitectPlan,
    ReviewVerdict,
    FinalAcceptance,
)
from src.rag_service import KnowledgeSearchTool
from src.workflow.agent import PgWorkflowStorage, WorkflowAgent
from src.tools.jules import JulesTools
from src.tools.task_manager import TaskManagementTool

# Import agents from the new agents.py file
from src.teams.development.agents import (
    AnalystAgent,
    ArchitectAgent,
    DeveloperAgent,
    ReviewerAgent,
    WorkerAgent,
    VerifierAgent,
)


leader_instructions = dedent("""
    You are the **Team Lead** of a high-performance software development team.
    Your goal is to coordinate the workflow between the User and your specialist agents (Analyst, Architect, Developer, Reviewer).

    # Coordination Rules
    1.  **Delegate Smartly**: Pass tasks to the most appropriate agent.
    2.  **Direct Communication**: Your agents (Analyst, Architect, etc.) speak directly to the user.
    3.  **NO REPETITION**: Do not summarize or repeat what your sub-agents just said.
    4.  **Format**: Ensure all output is in clean, readable **Markdown**.
    5.  **STOP ON QUESTIONS**: If a sub-agent asks the User a question, YOU MUST STOP. Do not answer for the User. Do not simulate the User's response.
    6.  **NO HALLUCINATION**: Do not simulate future steps. If the Analyst is working, do not claim the Architect is done. Wait for the actual tool outputs.
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
        # 1. Server-side Tools
        github_tool = GithubTools(access_token=github_token) if github_token else None

        # Initialize Task Tool (needed for listing projects)
        task_tool = TaskManagementTool(user_id=user_id, auth_token=auth_token)
        knowledge_tool = KnowledgeSearchTool(user_id=user_id, auth_token=auth_token) if user_id else None

        # 1. Analyst
        analyst = AnalystAgent(
            model=model,
            task_tool=task_tool,
            knowledge_tool=knowledge_tool,
            github_tool=github_tool,
            client_tools=client_tools,
            debug_mode=debug_mode,
            task_id=task_id,
        )

        # 2. Architect
        architect_tools = []
        if github_tool:
            architect_tools.append(github_tool)
        if client_tools:
            architect_tools.extend(client_tools)
        
        architect = ArchitectAgent(
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

        developer = DeveloperAgent(
            model=model,
            tools=developer_tools,
            debug_mode=debug_mode
        )

        # 4. Reviewer
        reviewer_tools = []
        if github_tool:
            reviewer_tools.append(github_tool)
        if client_tools:
            reviewer_tools.extend(client_tools)

        reviewer = ReviewerAgent(
            model=model,
            tools=reviewer_tools,
            debug_mode=debug_mode
        )

        # 5. Worker
        worker = WorkerAgent(
            model=model,
            task_tool=task_tool,
            jules_api_key=jules_api_key,
            client_tools=client_tools,
            debug_mode=debug_mode
        )

        # 6. Verifier
        verifier = VerifierAgent(
            model=model,
            debug_mode=debug_mode
        )

        # Team Lead tools (the team itself will have these)
        team_tools = []
        if github_tool:
            team_tools.append(github_tool)
        if knowledge_tool:
            team_tools.append(knowledge_tool)
        if client_tools:
            team_tools.extend(client_tools)

        # Workflow Storage
        self.workflow_storage = PgWorkflowStorage(db_url) if db_url else None
        self.user_id = user_id
        self.project_id = project_id
        self.task_id = task_id


        description = dedent("""
<identity>
You are the **Team Leader** of a Development Team, a powerful agentic AI coding assistant for the Genie project.
You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.
The USER will send you requests, which you must always prioritize addressing. Along with each USER request, we will attach additional metadata about their current state, such as what files they have open and where their cursor is.
This information may or may not be relevant to the coding task, it is up for you to decide.
Your team consists of:
- **Analyst** — clarifies requirements, identifies ambiguities
- **Architect** — designs technical solutions, defines components
- **Worker** — executes implementation plans via Jules API
- **Developer** — implements code and tests (manual/interactive mode)
- **Reviewer** — validates correctness, security, and quality
</identity>

<github_integration>
All changes must go through Pull Requests:
1. Create a feature branch for your changes
2. Commit atomic changes with descriptive messages
3. Create a Pull Request with clear title and description
4. Link PR to related issues when applicable
5. Never commit directly to main branch
6. Wait for CI checks to pass before requesting review
CI/CD Workflows:
- backend-ci.yml — Run tests and linters for api/ and back/
- backend-preview.yml — Deploy preview to Railway on PR
- pr-cleanup.yml — Delete preview environment on PR close
</github_integration>
<agentic_mode_overview>
You are in AGENTIC mode.
**Purpose**: The task view UI gives users clear visibility into your progress on complex work without overwhelming them with every detail.
**Core mechanic**: Communicate your progress to the user through structured responses.
**When to skip**: For simple work (answering questions, quick refactors, single-file edits that do not affect many lines etc.), skip detailed progress updates.
</agentic_mode_overview>
<mode_descriptions>
Set mode when calling task_boundary: PLANNING, EXECUTION, or VERIFICATION.
**PLANNING**: Research the codebase, understand requirements, and design your approach.
- Always create implementation_plan.md to document your proposed changes
- Get user approval before proceeding to EXECUTION
- If user requests changes, stay in PLANNING mode and update the plan
**EXECUTION**: Write code, make changes, implement your design.
- Return to PLANNING if you discover unexpected complexity or missing requirements
- Follow existing code patterns in each directory
- NEVER assume a library is available — check package files first
**VERIFICATION**: Test your changes, run verification steps, validate correctness.
- Create walkthrough.md after completing verification
- Document what you accomplished, what was tested, and validation results
- Run linters: go test ./..., pytest, npm run lint
- Create Pull Request for review
</mode_descriptions>
<task_artifact>
Path: task.md
**Purpose**: A detailed checklist to organize your work. Break down complex tasks into component-level items and track progress.
**Format**:
- [ ] uncompleted tasks
- [/] in progress tasks
- [x] completed tasks
- Use indented lists for sub-items
**Updating**: Mark items as [/] when starting work, and [x] when completed.
</task_artifact>
<implementation_plan_artifact>
Path: implementation_plan.md
**Purpose**: Document your technical plan during PLANNING mode.
**Format**:
# [Goal Description]
Brief description of the problem and what the change accomplishes.
## User Review Required
Document breaking changes or significant design decisions using GitHub alerts.
## Proposed Changes
Group files by component. Use [NEW], [MODIFY], [DELETE] markers.
## Verification Plan
### Automated Tests
- Exact commands to run
### Manual Verification
- Steps for manual testing
</implementation_plan_artifact>
<walkthrough_artifact>
Path: walkthrough.md
**Purpose**: After completing work, summarize what you accomplished.
**Document**:
- Changes made
- What was tested
- Validation results
</walkthrough_artifact>
<artifact_formatting_guidelines>
<format_tips>
# Markdown Formatting
Use standard markdown and GitHub Flavored Markdown formatting.
## Alerts
Use GitHub-style alerts to emphasize critical information:
> [!NOTE]
> Background context, implementation details
> [!TIP]
> Performance optimizations, best practices
> [!IMPORTANT]
> Essential requirements, critical steps
> [!WARNING]
> Breaking changes, compatibility issues
> [!CAUTION]
> High-risk actions, security vulnerabilities
## Code and Diffs
Use fenced code blocks with language specification:
```python
def example_function():
    return "Hello, World!"
Use diff blocks to show changes:

-old_function_name()
+new_function_name()
 unchanged_line()
Mermaid Diagrams
Create diagrams using mermaid code blocks to visualize architectures and workflows.

Tables
Use markdown tables for structured data.

File Links
Create clickable file links: 

link text
Link to line ranges: 

foo
Critical Rules
Keep lines short and concise
Use file basenames for readability
Do not surround link text with backticks </format_tips> </artifact_formatting_guidelines>
<workflow_context>
You have access to workflow artifacts that track the current state of development:
- **AnalystOutput**: Requirements analysis and acceptance criteria
- **ArchitectPlan**: Technical design and implementation plan
- **ReviewVerdict**: Code review results and approval status

**Check these artifacts before delegating** to understand what phase you're in and what has been completed.
</workflow_context>
<communication_style>

Formatting: Format responses in GitHub-style markdown. Use backticks for file, directory, function, and class names.
Proactiveness: Be proactive only in the course of completing the user task. Do not surprise the user with unexpected actions.
Helpfulness: Respond like a helpful software engineer explaining your work to a collaborator.
Ask for clarification: If unsure about the USER intent, always ask for clarification rather than making assumptions.
Concise: Minimize output tokens while maintaining helpfulness, quality, and accuracy. </communication_style>
<code_style>

IMPORTANT: DO NOT ADD ***ANY*** COMMENTS unless asked
Always follow security best practices
Never introduce code that exposes or logs secrets and keys
Never commit secrets or keys to the repository
NEVER commit changes unless the user explicitly asks you to </code_style>
The typical flow is: 1. **Analyst** clarifies requirements 2. **Architect** designs the solution 3. **Developer** implements code and tests 4. **Reviewer** validates the result 5. Create Pull Request for merge to main 
""")

        super().__init__(
            name="Development Team",
            id="development-team",
            model=model,
            instructions=leader_instructions,
            user_id=user_id,
            debug_mode=debug_mode,
            members=[analyst, architect, developer, reviewer, worker, verifier],
        )

        # Expose members attribute for Agno framework compatibility
        self.members = self.members

    def _parse_agent_output(self, output: Any, schema_class: Type[BaseModel]) -> Any:
        """Parses the agent output (string or dict). Returns Pydantic model if possible, else dict or str."""
        if isinstance(output, schema_class):
            return output
        
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
                return schema_class(**data)
            except Exception:
                # Fallback to dict if schema doesn't match
                return data
        
        return data

    def transition_to_next_step(
        self, task_id: str, current_role: str, output: any, session_id: str
    ):
        """
        Orchestrates the workflow state machine.
        Called after an agent completes its task.
        """
        if not self.workflow_storage:
            return

        # 0. Parse Output
        parsed_output = self._parse_agent_output(output, BaseModel)

        # 1. Save Artifact (generic fallback)
        # Note: If Analyst used save_requirements tool, the artifact is already saved via API.
        # But we also save the conversation output as an artifact record in workflow storage.

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

        self.workflow_storage.save_artifact(
            session_id, task_id, current_role, artifact_type, content
        )

        # 2. Update Status & Determine Next Step
        next_status = None

        if current_role == "Analyst":
            # For Analyst, trust the tool usage primarily.
            # But if output explicitly says "requirements saved" or similar, we might want to ensure state.
            pass

        elif current_role == "Architect":
            # Check if output contains a plan
            is_complete = False
            if isinstance(parsed_output, ArchitectPlan):
                is_complete = True
            elif isinstance(parsed_output, dict) and ("implementation_plan" in parsed_output or "context" in parsed_output):
                is_complete = True
            elif isinstance(parsed_output, str) and ("## 🛠 Implementation Plan" in parsed_output or "## 🏗 Architecture Decision" in parsed_output):
                is_complete = True

            if is_complete:
                next_status = "CODING"
            else:
                print("[Team] Architect output appears incomplete. Staying in planning phase.")
                return
        elif current_role == "Reviewer":
            # Check for "Approved" string in markdown if it's string, or property if dict
            is_approved = False
            if isinstance(parsed_output, str):
                if "**Status**: Approved" in parsed_output or "Status: Approved" in parsed_output:
                     is_approved = True
            elif isinstance(parsed_output, dict) and parsed_output.get("content", {}).get("approved"):
                 is_approved = True
            elif hasattr(parsed_output, "content") and parsed_output.content.approved:
                 is_approved = True
            
            if is_approved:
                next_status = "VERIFY"
            else:
                next_status = "CODING"  # Loop back for fixes

        if next_status:
            self._update_task_status(task_id, next_status, artifacts=content)


    def run_component(self, role: str, task_id: str):
        """
        Public method to manually trigger a specific agent (e.g. from Webhook).
        """
        agent = next((m for m in self.members if m.name == role), None)
        if agent:
            print(f"[Workflow] Manually triggering {role} for Task {task_id}")
            agent.run(
                message=f"External trigger for {role}.",
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
        if self.workflow_storage and self.task_id:
            try:
                # Get current phase from workflow artifacts
                current_phase = None
                artifacts = [
                    self.workflow_storage.get_artifact_by_task(
                        self.task_id, "AnalystOutput"
                    ),
                    self.workflow_storage.get_artifact_by_task(
                        self.task_id, "ArchitectPlan"
                    ),
                    self.workflow_storage.get_artifact_by_task(
                        self.task_id, "ReviewVerdict"
                    ),
                ]

                if artifacts[2]:  # Review completed
                    current_phase = "verification"
                elif artifacts[1]:  # Architecture completed
                    current_phase = "development"
                elif artifacts[0]:  # Analysis completed
                    current_phase = "design"

                # If we're in active development phase AND this is a simple message,
                # delegate to developer instead of analyst
                if current_phase in ["development", "design"]:
                    is_simple_message = (
                        any(word in message_lower for word in continuation_words)
                        or any(phrase in message_lower for phrase in status_words)
                        or any(word in message_lower for word in casual_words)
                        or len(message.split()) <= 2
                    )
                    if is_simple_message:
                        return False

            except Exception as e:
                print(f"[Team] Error checking workflow context: {e}")
                # Continue with delegation on error

        # Default: delegate to analyst for safety (new complex requests)
        return True
