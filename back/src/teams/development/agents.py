import json
from typing import Optional, List
from agno.agent import Agent
from agno.models.openai import OpenAIChat
from .models import AnalystOutput, ArchitectPlan, ArchitectDetails, ImplementationStep, AgentAction, ArchitectPlanContext, ArchitectureDecisionRecord
from src.tools.task_manager import TaskManagementTool

class ArchitectAgent:
    def __init__(self, task_manager: TaskManagementTool):
        self.task_manager = task_manager

        # Define the tool wrapper that the agent will use
        def create_implementation_plan(project_id: str, files_to_create: List[str], files_to_modify: List[str], subtasks: List[dict]) -> str:
            """
            Creates subtasks for the implementation plan.

            Args:
                project_id (str): The ID of the project.
                files_to_create (List[str]): List of files to create.
                files_to_modify (List[str]): List of files to modify.
                subtasks (List[dict]): List of subtasks to create. Each subtask must have 'title' and optional 'description'.

            Returns:
                str: Summary of created tasks.
            """
            results = []
            for task in subtasks:
                title = task.get("title")
                desc = task.get("description", "")
                priority = task.get("priority", "medium")

                if title:
                    result = task_manager.create_task(project_id, title, desc, priority)
                    results.append(result)

            return "\n".join(results)

        self.agent = Agent(
            name="Architect",
            role="Technical Architect",
            model=OpenAIChat(id="gpt-4o"),
            description="You are a Technical Architect. You break down PRDs into technical subtasks.",
            instructions=[
                "Read the PRD (AnalystOutput) provided in the context.",
                "Create a technical implementation plan.",
                "Use the `create_implementation_plan` tool to create subtasks in the project management system.",
                "The subtasks should be granular enough for developers (e.g., 'Create API endpoint X', 'Add database migration').",
                "Ensure you pass the correct project_id to the tool."
            ],
            tools=[create_implementation_plan],
            # show_tool_calls=True # Not supported in this version of Agno
        )

    def run(self, context: dict) -> ArchitectPlan:
        """
        Runs the architect agent with the given context.

        Args:
            context (dict): Must contain 'prd' (AnalystOutput) and 'project_id'.

        Returns:
            ArchitectPlan: The generated plan.
        """
        prd: AnalystOutput = context.get("prd")
        project_id = context.get("project_id")

        if not prd or not project_id:
            raise ValueError("Context must contain 'prd' and 'project_id'")

        # Create a prompt with the PRD
        prompt = f"""
        Project ID: {project_id}

        Functional Requirements:
        {json.dumps([req.dict() for req in prd.content.requirements], indent=2)}

        User Scenarios:
        {json.dumps([s.dict() for s in prd.content.scenarios], indent=2)}

        Affected Modules:
        {prd.content.affected_modules}

        Please analyze these requirements and create a technical implementation plan.
        Create specific subtasks for the development team using the provided tool.
        """

        response = self.agent.run(prompt)

        # For now, we return a basic ArchitectPlan based on the agent's text response.
        # In a real scenario, we might want structured output from the agent itself.
        # But per requirements, the side effect (creating tasks) is the key goal.

        return ArchitectPlan(
            msg="Plan created and tasks assigned.",
            content=ArchitectDetails(
                project_id=project_id,
                task_id=prd.content.task_id,
                adr=ArchitectureDecisionRecord(
                    title="Implementation Plan",
                    status="Accepted",
                    context="Derived from PRD",
                    decision="Split into subtasks",
                    consequences="Tasks created in system"
                ),
                technical_approach="Modular implementation",
                files_to_create=[], # Populated by tool ideally, or we can parse response
                files_to_modify=[],
                verification_steps=["Verify all tasks are completed"],
                context=ArchitectPlanContext(
                    repository_name="unknown", # specific to repo
                    branch_name="feature/implementation",
                    task_id=prd.content.task_id
                ),
                steps=[], # Steps are now tasks
                style_guide_rules=[],
                reference_snippets=[]
            )
        )
