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
        architect_tools = []
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
        self.verifier = VerifierAgent(
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

        # 1. Load State
        current_state = self._load_state(self.task_id)
        print(f"[Team] Task {self.task_id} state: {current_state}")

        response = None
        executed_role = None

        # 2. State-Based Routing
        # If the user message is explicit override, we might want to handle that,
        # but generally we follow the state.

        # State: ANALYSIS -> Analyst
        if current_state == "ANALYSIS" or current_state == "TODO": # Default start
            if self.should_delegate_to_analyst(message or ""):
                print("[Team] Routing to Analyst")
                response = self.analyst.run(message=message, stream=stream, **kwargs)
                executed_role = "Analyst"
            else:
                # User asking simple questions, handled by Team Lead or Analyst
                # Even if simple question, Analyst handles it contextually
                response = self.analyst.run(message=message, stream=stream, **kwargs)
                executed_role = "Analyst"

        # State: PLANNING -> Architect
        elif current_state == "PLANNING":
            print("[Team] Routing to Architect")
            # We need to make sure Architect has the requirements.
            # They are in artifacts, agent should find them via context or tools.
            response = self.architect.run(message=message, stream=stream, **kwargs)
            executed_role = "Architect"

        # State: CODING -> Developer OR Worker (Jules)
        elif current_state == "CODING" or current_state == "IN_PROGRESS":
            # Complexity Routing
            is_complex = self._check_complexity()

            if is_complex:
                print("[Team] Routing to Worker (Complex Task)")
                # Check if session already started?
                session_id = self._get_jules_session_id()
                if session_id:
                    print("[Team] Jules session active. Checking status is async via webhook.")
                    return "Jules is working on your task. You will be notified when a PR is created."
                else:
                    response = self.worker.run(message=message, stream=stream, **kwargs)
                    executed_role = "Worker"
            else:
                print("[Team] Routing to Developer (Simple Task)")
                response = self.developer.run(message=message, stream=stream, **kwargs)
                executed_role = "Developer"

        # State: REVIEW -> Reviewer
        elif current_state == "REVIEW":
            print("[Team] Routing to Reviewer")
            response = self.reviewer.run(message=message, stream=stream, **kwargs)
            executed_role = "Reviewer"

        # State: VERIFY -> Verifier
        elif current_state == "VERIFY":
            print("[Team] Routing to Verifier")
            response = self.verifier.run(message=message, stream=stream, **kwargs)
            executed_role = "Verifier"

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

        self.workflow_storage.save_artifact(
            session_id, task_id, current_role, artifact_type, content
        )

        # Also save Jules Session if Worker output contains it
        if current_role == "Worker" and isinstance(content, dict) and "name" in content:
            # Assume content is session object
            self.workflow_storage.save_artifact(
                session_id, task_id, "JulesSession", "Dict", {"session_id": content.get("name")}
            )

        # 2. Update Status & Determine Next Step
        next_status = None

        if current_role == "Analyst":
            # State transition is handled by tool save_requirements usually,
            # but if it returns here, we might verify.
            # If artifact is AnalystOutput, we move to PLANNING
            if artifact_type == "AnalystOutput" or (isinstance(content, dict) and "functional_requirements" in content):
                 next_status = "PLANNING"

        elif current_role == "Architect":
            # Check if output contains a plan
            is_complete = False
            if isinstance(parsed_output, ArchitectPlan):
                is_complete = True
            elif isinstance(parsed_output, dict) and ("implementation_plan" in parsed_output or "files_to_modify" in parsed_output):
                is_complete = True
            elif isinstance(parsed_output, str) and ("## 🛠 Implementation Plan" in parsed_output or "## 🏗 Architecture Decision" in parsed_output):
                is_complete = True

            if is_complete:
                next_status = "CODING"
            else:
                print("[Team] Architect output appears incomplete. Staying in planning phase.")
                return

        elif current_role == "Worker":
            # Worker (Jules) usually works async. If it returns immediately with session started:
            pass

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
        # Note: run() method now handles phase checking, so this might be redundant or just a helper.
        return True
