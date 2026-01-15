from typing import Optional, List, Any, Type
import os
import re
import json
import logging
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
from src.teams.development.agents import (
    leader_instructions,
    analyst_instructions,
    architect_instructions,
    developer_instructions,
    reviewer_instructions,
    worker_instructions,
    verifier_instructions,
)
from src.rag_service import KnowledgeSearchTool
from src.workflow.agent import PgWorkflowStorage, WorkflowAgent
from src.tools.jules import JulesTools
from src.tools.task_manager import TaskManagementTool

# Set up logger
logger = logging.getLogger(__name__)

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

        architect_tools = []
        if github_tool:
            architect_tools.append(github_tool)

        # Jules API key: prefer passed parameter, fallback to env var
        effective_jules_key = jules_api_key or os.getenv("JULES_API_KEY", "")
        worker_tools = [task_tool]
        
        # Check if Jules tool is already in client_tools
        jules_tool_exists = False
        if client_tools:
            for tool in client_tools:
                if isinstance(tool, JulesTools):
                    jules_tool_exists = True
                    print("[DevelopmentTeam] Found existing JulesTools in client_tools")
                    break
        
        if jules_tool_exists:
            # Already have the tool, no need to add again or warn
            pass
        elif effective_jules_key:
            worker_tools.insert(0, JulesTools(api_key=effective_jules_key))
            print("[DevelopmentTeam] Jules tools enabled")
        else:
            print(
                "[DevelopmentTeam] Warning: Jules API key not provided, Jules tools disabled"
            )

        # Analyst and Verifier tools
        analyst_tools = []
        
        # ADD TASK TOOL TO ANALYST (So they can list projects)
        analyst_tools.append(task_tool)

        if user_id:
            analyst_tools.append(
                KnowledgeSearchTool(user_id=user_id, auth_token=auth_token)
            )
        if github_tool:
            analyst_tools.append(github_tool)

        # Add client tools to all agents (or specific ones)
        if client_tools:
            analyst_tools.extend(client_tools)
            if github_tool:
                architect_tools.extend(client_tools)
            # Worker might not need all client tools, but let's be inclusive if they are generic
            worker_tools.extend(client_tools)

        # Team Lead tools (the team itself will have these)
        team_tools = []
        if github_tool:
            team_tools.append(github_tool)
        if user_id:
            team_tools.append(
                KnowledgeSearchTool(user_id=user_id, auth_token=auth_token)
            )
        if client_tools:
            team_tools.extend(client_tools)

        # Workflow Storage
        self.workflow_storage = PgWorkflowStorage(db_url) if db_url else None
        self.user_id = user_id
        self.project_id = project_id
        self.task_id = task_id


        super().__init__(
            name="Development Team",
            id="development-team",
            model=model,
            instructions=leader_instructions,
            user_id=user_id,
            debug_mode=debug_mode,
            members=[
                Agent(
                    name="Analyst",
                    role="Analyst",
                    id="analyst",
                    model=model,
                    instructions=analyst_instructions,
                    tools=analyst_tools,
                    markdown=True,
                ),
                Agent(
                    name="Architect",
                    role="Architect",
                    id="architect",
                    model=model,
                    instructions=architect_instructions,
                    tools=architect_tools,
                    markdown=True,
                ),
                Agent(
                    name="Developer",
                    role="Developer",
                    id="developer",
                    model=model,
                    instructions=developer_instructions,
                    tools=[github_tool] if github_tool else [],
                    markdown=True,
                ),
                Agent(
                    name="Reviewer",
                    role="Reviewer",
                    id="reviewer",
                    model=model,
                    instructions=reviewer_instructions,
                    tools=[github_tool] if github_tool else [],
                    markdown=True,
                ),
                Agent(
                    name="Worker",
                    role="Worker",
                    id="worker",
                    model=model,
                    instructions=worker_instructions,
                    tools=worker_tools,
                    markdown=True,
                ),
                Agent(
                    name="Verifier",
                    role="Verifier",
                    id="verifier",
                    model=model,
                    instructions=verifier_instructions,
                    markdown=True,
                ),
            ],
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

        # 0. Parse Output Output manually since we removed output_schema
        # 0. Parse Output
        parsed_output = self._parse_agent_output(output, BaseModel) # Schema doesn't matter much if we handle dict/str

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
             # For Analysis, map string to "AnalystOutput" type so logic downstream works?
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
        next_role = None

        if current_role == "Analyst":
            # Check if output is complete coverage of requirements
            is_complete = False
            if isinstance(parsed_output, AnalystOutput):
                is_complete = True
            elif isinstance(parsed_output, dict) and ("requirements" in parsed_output or "content" in parsed_output):
                is_complete = True
            elif isinstance(parsed_output, str) and ("## ✅ Definition of Done" in parsed_output or "## 📝 Requirements" in parsed_output):
                is_complete = True
            
            if is_complete:
                 next_status = "PLANNING"
                 next_role = "Architect"
            else:
                 print("[Team] Analyst output appears to be questions/clarification. Staying in analysis phase.")
                 return

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
                next_role = "Developer"
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
                next_role = "Verifier"
            else:
                next_status = "CODING"
                next_role = "Developer"  # Loop back for fixes

        if next_status:
            self._update_task_status(task_id, next_status, artifacts=content)

        # 3. DO NOT auto-trigger next agent - let Team Leader decide based on context
        # This prevents forced delegation and allows intelligent decision-making
        # Team Leader will check workflow artifacts and user intent before delegating

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
            # We might not have session_id here if called from webhook (new context).
            # But WorkflowAgent.run looks up by task_id too.
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
                    # For simple messages in development phase, don't delegate to analyst
                    # (they'll be handled by developer instead)
                    # But complex requests should still go to analyst for clarification
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
