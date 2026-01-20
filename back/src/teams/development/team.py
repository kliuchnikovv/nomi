from typing import Optional, List, Any, Type
import os
import redis
import logging
import json
import re

from agno.db import BaseDb
from agno.models.base import Model

# from agno.team import Team # Removed
from agno.workflow import Workflow, Step, Condition, StepInput, StepOutput
from agno.tools import Toolkit
from src.tools.factory import SafeGithubTools
from pydantic import TypeAdapter, BaseModel

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
from src.teams.development.state import (
    WorkflowStage,
    WorkflowState,
    StateManager,
    MAX_RETRY_COUNT,
    ReviewHistoryEntry,
)

# Set up logger
logger = logging.getLogger(__name__)

# --- INSTRUCTIONS (Restored for factory.py compatibility) ---
analyst_instructions = ANALYST_INSTRUCTIONS
architect_instructions = ARCHITECT_INSTRUCTIONS
developer_instructions = DEVELOPER_INSTRUCTIONS
reviewer_instructions = REVIEWER_INSTRUCTIONS
worker_instructions = WORKER_INSTRUCTIONS
leader_instructions = TEAM_LEAD_INSTRUCTIONS


class DevelopmentTeam(Workflow):
    def __init__(
        self,
        model: Model | None = None,
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
        **kwargs,
    ):
        self.github_token = github_token
        self.jules_api_key = jules_api_key
        self.db_url = db_url
        self.client_tools = client_tools
        self.model = model
        # Initialize GitHub tools if token is provided
        github_tool = (
            SafeGithubTools(access_token=github_token) if github_token else None
        )
        self.github_tool = github_tool

        # Initialize Git Tool (Local)
        git_tool = GitTools(repo_path=".", allow_destructive=False)

        # Initialize Task Tool
        task_tool = TaskManagementTool(user_id=user_id, auth_token=auth_token)
        knowledge_tool = (
            KnowledgeSearchTool(user_id=user_id, auth_token=auth_token)
            if user_id
            else None
        )

        # 1. Analyst
        self.analyst = AnalystAgent(
            model=model,
            task_tool=task_tool,
            knowledge_tool=knowledge_tool,
            github_tool=github_tool,
            client_tools=client_tools,
            debug_mode=debug_mode,
            task_id=task_id,
            project_id=project_id,
        )

        # 2. Architect
        architect_tools = [task_tool]
        if github_tool:
            architect_tools.append(github_tool)
        if client_tools:
            architect_tools.extend(client_tools)

        self.architect = ArchitectAgent(
            model=model, tools=architect_tools, debug_mode=debug_mode
        )

        # 3. Developer
        developer_tools = []
        if github_tool:
            developer_tools.append(github_tool)
        if client_tools:
            developer_tools.extend(client_tools)

        self.developer = DeveloperAgent(
            model=model, tools=developer_tools, git_tool=git_tool, debug_mode=debug_mode
        )

        # 4. Reviewer
        reviewer_tools = []
        if github_tool:
            reviewer_tools.append(github_tool)
        if client_tools:
            reviewer_tools.extend(client_tools)

        self.reviewer = ReviewerAgent(
            model=model, tools=reviewer_tools, git_tool=git_tool, debug_mode=debug_mode
        )

        # 5. Worker
        self.worker = WorkerAgent(
            model=model,
            task_tool=task_tool,
            jules_api_key=jules_api_key,
            client_tools=client_tools,
            debug_mode=debug_mode,
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
            model=model, tools=verifier_tools, debug_mode=debug_mode
        )

        # Workflow Storage
        self.workflow_storage = PgWorkflowStorage(db_url) if db_url else None
        self.user_id = user_id
        self.project_id = project_id
        self.task_id = task_id
        self.auth_token = auth_token

        # Tools required for AgentOS compatibility
        self.tools = []
        if client_tools:
            self.tools.extend(client_tools)
        if github_tool:
            self.tools.append(github_tool)

        super().__init__(
            name="Development Team",
            description="Autonomous Development Team Workflow",
            steps=[
                Condition(
                    name="Analysis Phase",
                    evaluator=self.should_run_analysis,
                    steps=[Step(name="Analyst", agent=self.analyst)],
                ),
                Condition(
                    name="Clarification Needed",
                    evaluator=self.should_run_clarification,
                    steps=[
                        Step(
                            name="Clarification Handler",
                            executor=self.handle_clarification,
                        )
                    ],
                ),
                Condition(
                    name="Architecture Phase",
                    evaluator=self.should_run_architecture,
                    steps=[Step(name="Architect", agent=self.architect)],
                ),
                Condition(
                    name="Approval Pending",
                    evaluator=self.should_run_approval,
                    steps=[
                        Step(name="Approval Handler", executor=self.handle_approval)
                    ],
                ),
                Condition(
                    name="Development Phase",
                    evaluator=self.should_run_development,
                    steps=[
                        Step(
                            name="Developer or Worker",
                            executor=self.execute_development,
                        )
                    ],
                ),
                Condition(
                    name="Code Review Phase",
                    evaluator=self.should_run_code_review,
                    steps=[Step(name="Reviewer", agent=self.reviewer)],
                ),
                Condition(
                    name="DOD Check Phase",
                    evaluator=self.should_run_dod_check,
                    steps=[Step(name="Verifier", agent=self.verifier)],
                ),
                Condition(
                    name="Delivery Phase",
                    evaluator=self.should_run_delivery,
                    steps=[
                        Step(name="Delivery Handler", executor=self.handle_delivery)
                    ],
                ),
                Condition(
                    name="Human Intervention",
                    evaluator=self.should_run_intervention,
                    steps=[
                        Step(
                            name="Intervention Handler",
                            executor=self.handle_intervention,
                        )
                    ],
                ),
            ],
            # Pass other kwargs that Workflow might accept
        )

        # Tools required for AgentOS compatibility
        self.members = [
            self.analyst,
            self.architect,
            self.developer,
            self.reviewer,
            self.worker,
            self.verifier,
        ]
        self.knowledge = None
        self.memory = None
        self.tool_call_limit = None
        self.instructions = None
        self.tool_choice = None
        self.description = "Development Team Workflow"
        self.add_history_to_context = True
        self.debug_mode = debug_mode
        self.db = db

    def initialize_team(self):
        """Initialized the team. Required for AgentOS compatibility."""
        pass

    def deep_copy(self, **kwargs):
        """Override deep_copy to preserve custom parameters like model."""
        return DevelopmentTeam(
            model=self.model,
            db=self.db,
            github_token=self.github_token,
            jules_api_key=self.jules_api_key,
            debug_mode=self.debug_mode,
            user_id=self.user_id,
            auth_token=self.auth_token,
            project_id=self.project_id,
            task_id=getattr(self, "task_id", None),
            db_url=self.db_url,
            client_tools=self.client_tools,
            **kwargs,
        )

    def _determine_tools_for_model(self, *args, **kwargs) -> List[Any]:
        """Compatibility method for AgentOS."""
        return self.tools

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

    async def run(
        self,
        message: Optional[str] = None,
        stream: bool = False,
        **kwargs,
    ) -> Any:
        if self.check_cancellation():
            return "PROCESS_STOPPED_BY_USER"

        full_message = self._inject_context(message)
        logger.info(f"[Team] Running Workflow for Task {self.task_id}")

        if "input" not in kwargs and message:
            kwargs["input"] = full_message
        elif "input" in kwargs:
            kwargs["input"] = self._inject_context(kwargs["input"])

        # Get the iterator from Workflow.run
        # Note: Workflow.run is typically regular method returning iterator/coroutine
        # We await it if it's async, or call it.
        # Assuming agno Workflow.run returns an AsyncIterator when stream=True

        iterator = super().run(stream=stream, **kwargs)

        if stream:
            return self._stream_adapter(iterator)
        return iterator

    async def _stream_adapter(self, iterator: Any) -> Any:
        """Adapts Workflow events to RedisSession-compatible events."""

        class FlowEvent:
            def __init__(self, content, agent_name=None):
                self.content = content
                self.agent_name = agent_name

        class RunContentEvent(FlowEvent):
            pass

        class RunCompleted(FlowEvent):
            pass

        # Helper to process events
        async def process_event(event):
            try:
                # Check for Step Events
                if hasattr(event, "step") and event.step:
                    step_name = event.step.name
                    if hasattr(event, "phase"):
                        if event.phase == "start":
                            yield RunContentEvent(
                                content=f"\n🔄 **Starting Phase: {step_name}**\n"
                            )

                # If the event itself has 'content', yield it
                if hasattr(event, "content") and event.content:
                    agent_name = (
                        getattr(event.step, "name", "Development Team")
                        if hasattr(event, "step")
                        else "Development Team"
                    )
                    yield RunContentEvent(content=event.content, agent_name=agent_name)

                yield event
            except Exception as e:
                logger.error(f"Error in stream adapter: {e}")
                yield event

        if hasattr(iterator, "__aiter__"):
            async for event in iterator:
                async for final_event in process_event(event):
                    yield final_event
        else:
            for event in iterator:
                async for final_event in process_event(event):
                    yield final_event

    def _inject_context(self, message: Optional[str]) -> str:
        if not message:
            return ""

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
            except Exception:
                pass

        if context_lines:
            return message + "\n\n[SYSTEM CONTEXT]\n" + "\n".join(context_lines)
        return message

    # --- Helpers ---
    def _get_current_state(self) -> WorkflowState:
        if not self.workflow_storage or not self.task_id:
            return StateManager.get_initial_state()

        try:
            state_dict = self.workflow_storage.get_workflow_state(self.task_id)
            if state_dict:
                return TypeAdapter(WorkflowState).validate_python(state_dict)
        except Exception as e:
            logger.error(f"Error loading state: {e}")

        return StateManager.get_initial_state()

    def _update_state(self, new_state: WorkflowState):
        if self.workflow_storage and self.task_id:
            try:
                self.workflow_storage.save_workflow_state(
                    self.task_id, new_state.model_dump()
                )
            except Exception as e:
                logger.error(f"Error saving state: {e}")

    def _save_artifact(self, role: str, output: Any) -> Optional[str]:
        if not self.workflow_storage or not self.task_id:
            return None

        parsed_output = self._parse_agent_output(output, BaseModel)

        artifact_type = "Markdown"
        content = parsed_output

        if hasattr(parsed_output, "model_dump"):
            artifact_type = type(parsed_output).__name__
            content = parsed_output.model_dump()
        elif isinstance(parsed_output, dict):
            artifact_type = "Dict"
            content = parsed_output
        elif isinstance(parsed_output, str):
            if role == "Analyst":
                artifact_type = "AnalystOutput"
            elif role == "Architect":
                artifact_type = "ArchitectPlan"
            elif role == "Reviewer":
                artifact_type = "ReviewVerdict"
            elif role == "Verifier":
                artifact_type = "FinalAcceptance"
            content = {"markdown": parsed_output}

        return self.workflow_storage.save_artifact(
            self.task_id, self.task_id, role, artifact_type, content
        )

    def _parse_agent_output(self, output: Any, schema_class: Type[BaseModel]) -> Any:
        try:
            if (
                isinstance(output, schema_class)
                if isinstance(schema_class, type)
                else False
            ):
                return output
        except TypeError:
            pass

        data = output
        if isinstance(output, str):
            try:
                match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", output, re.DOTALL)
                if match:
                    data = json.loads(match.group(1))
                else:
                    if output.strip().startswith("{"):
                        data = json.loads(output)
                    else:
                        return output
            except Exception:
                return output

        if isinstance(data, dict):
            try:
                adapter = TypeAdapter(schema_class)
                return adapter.validate_python(data)
            except Exception:
                return data

        return data

    def _get_content_from_response(self, response: Any) -> Any:
        if hasattr(response, "content"):
            return response.content
        return response

    def _check_user_approval(self, message: str) -> str:
        msg_lower = message.lower().strip()
        if any(
            w in msg_lower
            for w in ["approve", "approved", "ok", "утверждаю", "да", "yes", "proceed"]
        ):
            return "APPROVED"
        elif any(
            w in msg_lower
            for w in [
                "reject requirements",
                "change requirements",
                "wrong requirements",
            ]
        ):
            return "REJECTED_REQUIREMENTS"
        elif any(
            w in msg_lower
            for w in ["reject", "no", "change architecture", "wrong plan"]
        ):
            return "REJECTED_ARCHITECTURE"
        return "WAITING"

    def _check_complexity(self) -> bool:
        if not self.workflow_storage or not self.task_id:
            return False
        try:
            plan_artifact = self.workflow_storage.get_artifact_by_task(
                self.task_id, "ArchitectPlan"
            )
            if plan_artifact:
                content = plan_artifact.get("content", {})
                files = content.get("files_to_modify", []) + content.get(
                    "files_to_create", []
                )
                if len(files) > 2:
                    return True
        except Exception:
            pass
        return False

    def _get_jules_session_id(self) -> Optional[str]:
        if not self.workflow_storage or not self.task_id:
            return None
        worker_artifact = self.workflow_storage.get_artifact_by_task(
            self.task_id, "JulesSession"
        )
        if worker_artifact:
            return worker_artifact.get("content", {}).get("session_id")
        return None

    def _is_clarification_response(self, response: Any) -> bool:
        content = self._get_content_from_response(response)
        if isinstance(content, dict) and content.get("type") == "CLARIFICATION_NEEDED":
            return True
        return False

    # --- Evaluators ---
    def should_run_analysis(self, step_input: StepInput) -> bool:
        return self._get_current_state().stage == WorkflowStage.ANALYSIS

    def should_run_clarification(self, step_input: StepInput) -> bool:
        return self._get_current_state().stage == WorkflowStage.CLARIFICATION_NEEDED

    def should_run_architecture(self, step_input: StepInput) -> bool:
        return self._get_current_state().stage == WorkflowStage.ARCHITECTURE

    def should_run_approval(self, step_input: StepInput) -> bool:
        return self._get_current_state().stage == WorkflowStage.APPROVAL_PENDING

    def should_run_development(self, step_input: StepInput) -> bool:
        return self._get_current_state().stage == WorkflowStage.DEVELOPMENT

    def should_run_code_review(self, step_input: StepInput) -> bool:
        return self._get_current_state().stage == WorkflowStage.CODE_REVIEW

    def should_run_dod_check(self, step_input: StepInput) -> bool:
        return self._get_current_state().stage == WorkflowStage.DOD_CHECK

    def should_run_delivery(self, step_input: StepInput) -> bool:
        s = self._get_current_state().stage
        return (
            s == WorkflowStage.DELIVERY_HANDOFF
            or s == WorkflowStage.WAITING_FOR_USER_MERGE
        )

    def should_run_intervention(self, step_input: StepInput) -> bool:
        return self._get_current_state().stage == WorkflowStage.NEED_HUMAN_INTERVENTION

    # --- Executors ---
    def run_analyst(self, step_input: StepInput) -> StepOutput:
        response = self.analyst.run(input=step_input.input)
        content = self._get_content_from_response(response)

        # State Transition Logic
        current_state = self._get_current_state()
        if self._is_clarification_response(response):
            questions = (
                content.get("questions", []) if isinstance(content, dict) else []
            )
            new_state = StateManager.transition(
                current_state,
                WorkflowStage.CLARIFICATION_NEEDED,
                {"questions": questions},
            )
            self._update_state(new_state)
        else:
            # Assume success if not clarification
            artifact_id = self._save_artifact("Analyst", content)
            new_state = StateManager.transition(
                current_state, WorkflowStage.ARCHITECTURE, {"prd_id": artifact_id}
            )
            self._update_state(new_state)

        return StepOutput(content=content, success=True)

    def handle_clarification(self, step_input: StepInput) -> StepOutput:
        current_state = self._get_current_state()
        try:
            # Transition to ANALYSIS
            prev_questions = (
                current_state.questions if hasattr(current_state, "questions") else []
            )
            new_state = StateManager.transition(
                current_state, WorkflowStage.ANALYSIS, {}
            )
            self._update_state(new_state)

            # Construct context for next run
            context_override = f"\\n[System] ACTION REQUIRED: Users clarified. Prev questions: {prev_questions}"
            return StepOutput(content=context_override, success=True)
        except Exception as e:
            return StepOutput(content=f"Error: {e}", success=False)

    def run_architect(self, step_input: StepInput) -> StepOutput:
        response = self.architect.run(input=step_input.input)
        content = self._get_content_from_response(response)

        artifact_id = self._save_artifact("Architect", content)
        current_state = self._get_current_state()
        new_state = StateManager.transition(
            current_state, WorkflowStage.APPROVAL_PENDING, {"plan_id": artifact_id}
        )
        self._update_state(new_state)

        return StepOutput(content=content, success=True)

    def handle_approval(self, step_input: StepInput) -> StepOutput:
        message = step_input.input or ""
        approval = self._check_user_approval(message)
        current_state = self._get_current_state()

        if approval == "APPROVED":
            new_state = StateManager.transition(
                current_state, WorkflowStage.DEVELOPMENT, {}
            )
            self._update_state(new_state)
            return StepOutput(content="APPROVED", success=True)
        elif approval == "REJECTED_REQUIREMENTS":
            new_state = StateManager.transition(
                current_state, WorkflowStage.ANALYSIS, {}
            )
            self._update_state(new_state)
            return StepOutput(content="Requirements Rejected", success=True)
        elif approval == "REJECTED_ARCHITECTURE":
            new_state = StateManager.transition(
                current_state, WorkflowStage.ARCHITECTURE, {}
            )
            self._update_state(new_state)
            return StepOutput(content="Architecture Rejected", success=True)

        return StepOutput(content="Waiting for approval", success=True)

    def execute_development(self, step_input: StepInput) -> StepOutput:
        is_complex = self._check_complexity()
        current_state = self._get_current_state()

        if is_complex:
            session_id = self._get_jules_session_id()
            if session_id:
                # Jules is already running
                return StepOutput(
                    content=f"Jules running task {session_id}", success=True
                )

            response = self.worker.run(input=step_input.input)
            content = self._get_content_from_response(response)

            # Check if session started
            sess_id = None
            if isinstance(content, dict):
                sess_id = content.get("session_id")

            if sess_id:
                context_updates = {"jules_task_id": sess_id}
                self._save_artifact("Worker", content)
                new_state = StateManager.transition(
                    current_state, WorkflowStage.DEVELOPMENT, context_updates
                )  # Re-enter dev with ID
                self._update_state(new_state)

            return StepOutput(content=content, success=True)
        else:
            response = self.developer.run(input=step_input.input)
            content = self._get_content_from_response(response)

            # Check for PR URL
            pr_url = None
            if isinstance(content, dict):
                pr_url = content.get("pr_url")
            if isinstance(content, str):
                match = re.search(r"https://github\\.com/[^\\s]+/pull/\\d+", content)
                if match:
                    pr_url = match.group(0)

            if pr_url:
                new_state = StateManager.transition(
                    current_state, WorkflowStage.CODE_REVIEW, {"pr_url": pr_url}
                )
                self._update_state(new_state)

            return StepOutput(content=content, success=True)

    def run_reviewer(self, step_input: StepInput) -> StepOutput:
        response = self.reviewer.run(input=step_input.input)
        content = self._get_content_from_response(response)

        artifact_id = self._save_artifact("Reviewer", content)
        current_state = self._get_current_state()

        # Parse verdict
        verdict = "REJECT"
        if isinstance(content, str) and "Status: Approved" in content:
            verdict = "APPROVED"

        # Add history
        # ReviewHistoryEntry is a Pydantic model
        # We need to perform the logic here similar to workflow.py

        review_entry = ReviewHistoryEntry(
            role="Reviewer", status=verdict, comment=str(content)[:100]
        )
        current_state.review_history.append(review_entry)

        if verdict == "APPROVED":
            new_state = StateManager.transition(
                current_state,
                WorkflowStage.DOD_CHECK,
                {"review_verdict_id": artifact_id},
            )
        else:
            # Check retries
            if current_state.retry_count >= MAX_RETRY_COUNT:
                new_state = StateManager.transition(
                    current_state,
                    WorkflowStage.NEED_HUMAN_INTERVENTION,
                    {"reason": "Max retries"},
                )
            else:
                current_state.retry_count += 1
                new_state = StateManager.transition(
                    current_state,
                    WorkflowStage.DEVELOPMENT,
                    {"retry_count": current_state.retry_count},
                )

        self._update_state(new_state)
        return StepOutput(content=content, success=True)

    def run_verifier(self, step_input: StepInput) -> StepOutput:
        response = self.verifier.run(input=step_input.input)
        content = self._get_content_from_response(response)

        self._save_artifact("Verifier", content)
        current_state = self._get_current_state()

        is_pass = False
        if isinstance(content, str) and (
            "Status: PASS" in content or "**Status**: PASS" in content
        ):
            is_pass = True

        if is_pass:
            new_state = StateManager.transition(
                current_state, WorkflowStage.DELIVERY_HANDOFF, {}
            )
        else:
            new_state = StateManager.transition(
                current_state, WorkflowStage.DEVELOPMENT, {}
            )

        self._update_state(new_state)
        return StepOutput(content=content, success=True)

    def handle_delivery(self, step_input: StepInput) -> StepOutput:
        current_state = self._get_current_state()
        if current_state.stage == WorkflowStage.DELIVERY_HANDOFF:
            # Create report
            report = "Final Report Generated."
            new_state = StateManager.transition(
                current_state,
                WorkflowStage.WAITING_FOR_USER_MERGE,
                {"final_report": report},
            )
            self._update_state(new_state)
            return StepOutput(content=report, success=True)

        return StepOutput(content="Waiting for User Merge", success=True)

    def handle_intervention(self, step_input: StepInput) -> StepOutput:
        return StepOutput(content="Human Intervention Required", success=True)
