from typing import List, Optional
import os
from agno.agent import Agent
from agno.models.base import Model
from agno.knowledge import Knowledge
from agno.tools import Toolkit
from agno.tools.github import GithubTools

from src.teams.development.prompts import (
    ANALYST_INSTRUCTIONS,
    ARCHITECT_INSTRUCTIONS,
    DEVELOPER_INSTRUCTIONS,
    REVIEWER_INSTRUCTIONS,
    WORKER_INSTRUCTIONS,
    VERIFIER_INSTRUCTIONS,
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
        task_id: Optional[str] = None,
        project_id: Optional[str] = None,
        knowledge: Optional[Knowledge] = None,
        **kwargs,
    ):
        self.task_tool = task_tool
        self.task_id = task_id

        import logging

        logger = logging.getLogger(__name__)
        logger.info("[AnalystAgent] Initialized with task_id=%s", task_id)

        tools = [self.save_requirements, task_tool]
        if knowledge_tool:
            tools.append(knowledge_tool)
        if github_tool:
            tools.append(github_tool)
        if client_tools:
            tools.extend(client_tools)

        instructions = ANALYST_INSTRUCTIONS
        if project_id:
            instructions = (
                f"**Current Project ID**: `{project_id}`. Use this ID for all project-related tools.\n\n"
                + instructions
            )

        super().__init__(
            name="Analyst",
            role="Business Analyst",
            id="analyst",
            model=model,
            instructions=instructions,
            tools=tools,
            knowledge=knowledge,
            search_knowledge=(knowledge is not None),  # Enable agentic search if knowledge provided
            update_knowledge=(knowledge is not None),  # Enable automatic fact storage
            markdown=True,
            debug_mode=debug_mode,
        )

    def save_requirements(
        self,
        summary: str,
        user_stories: List[str],
        functional_requirements: List[str],
        acceptance_criteria: List[str],
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
            "acceptance_criteria": acceptance_criteria,
        }

        # Save artifact and update status to PLANNING via TaskTool
        # If task_id is known (injected at init or found in context), use it.
        # Ideally, the agent context has it, but for now we rely on self.task_id or passed in tools

        task_id = self.task_id
        if not task_id:
            return "Error: No task_id available to save requirements. I lack a task_id to save requirements. Please ask the Team Leader to provide the task context or use list_projects to find available projects."

        # Update task status to PLANNING
        result = self.task_tool.update_task_status(
            task_id=task_id, status="PLANNING", artifacts=artifact
        )

        if result.startswith("Error") or "Error updating status" in result:
            return f"FAILED to save requirements. {result}"

        return f"Requirements saved. Transitioning to PLANNING. Result: {result}"


# --- ARCHITECT ---
class ArchitectAgent(Agent):
    def __init__(
        self, model: Model, tools: List[Toolkit], debug_mode: bool = False, knowledge: Optional[Knowledge] = None, **kwargs
    ):
        super().__init__(
            name="Architect",
            role="Architect",
            id="architect",
            model=model,
            instructions=ARCHITECT_INSTRUCTIONS,
            tools=tools,
            knowledge=knowledge,
            search_knowledge=(knowledge is not None),  # Enable agentic search if knowledge provided
            update_knowledge=(knowledge is not None),  # Enable automatic fact storage
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
        debug_mode: bool = False,
        knowledge: Optional[Knowledge] = None,
        **kwargs,
    ):
        agent_tools = tools if tools else []
        if git_tool:
            agent_tools.append(git_tool)

        super().__init__(
            name="Developer",
            role="Developer",
            id="developer",
            model=model,
            instructions=DEVELOPER_INSTRUCTIONS,
            tools=agent_tools,
            knowledge=knowledge,
            search_knowledge=(knowledge is not None),  # Enable agentic search if knowledge provided
            update_knowledge=(knowledge is not None),  # Enable automatic fact storage
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
        debug_mode: bool = False,
        knowledge: Optional[Knowledge] = None,
        **kwargs,
    ):
        agent_tools = tools if tools else []
        if git_tool:
            agent_tools.append(git_tool)

        super().__init__(
            name="Reviewer",
            role="Reviewer",
            id="reviewer",
            model=model,
            instructions=REVIEWER_INSTRUCTIONS,
            tools=agent_tools,
            knowledge=knowledge,
            search_knowledge=(knowledge is not None),  # Enable agentic search if knowledge provided
            update_knowledge=(knowledge is not None),  # Enable automatic fact storage
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
        debug_mode: bool = False,
        knowledge: Optional[Knowledge] = None,
        **kwargs,
    ):
        # Build tools list
        tools: List[Toolkit] = [task_tool]

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
            instructions=WORKER_INSTRUCTIONS,
            tools=tools,
            knowledge=knowledge,
            search_knowledge=(knowledge is not None),  # Enable agentic search if knowledge provided
            update_knowledge=(knowledge is not None),  # Enable automatic fact storage
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
        debug_mode: bool = False,
        knowledge: Optional[Knowledge] = None,
        **kwargs,
    ):
        agent_tools = tools if tools else []

        super().__init__(
            name="Verifier",
            role="QA Engineer / DOD Checker",
            id="verifier",
            model=model,
            instructions=VERIFIER_INSTRUCTIONS,
            tools=agent_tools,
            knowledge=knowledge,
            search_knowledge=(knowledge is not None),  # Enable agentic search if knowledge provided
            update_knowledge=(knowledge is not None),  # Enable automatic fact storage
            markdown=True,
            debug_mode=debug_mode,
        )
