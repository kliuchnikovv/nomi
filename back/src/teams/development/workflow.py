from typing import Optional, List, Any, Dict, Type
import logging
import json
import re

from agno.workflow import Workflow, Step, Condition, StepInput, StepOutput
from agno.agent import Agent
from pydantic import TypeAdapter, BaseModel

from src.teams.development.state import WorkflowStage, WorkflowState, StateManager, WorkflowStatus, MAX_RETRY_COUNT, ReviewHistoryEntry
from src.teams.development.models import AnalystOutput, ArchitectPlan, ReviewVerdict, FinalAcceptance
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

class DevelopmentWorkflow(Workflow):
    def __init__(
        self,
        analyst: AnalystAgent,
        architect: ArchitectAgent,
        developer: DeveloperAgent,
        reviewer: ReviewerAgent,
        worker: WorkerAgent,
        verifier: VerifierAgent,
        workflow_storage: Any, # PgWorkflowStorage
        task_id: str,
        project_id: Optional[str] = None,
        *args, **kwargs
    ):
        self.analyst = analyst
        self.architect = architect
        self.developer = developer
        self.reviewer = reviewer
        self.worker = worker
        self.verifier = verifier
        self.workflow_storage = workflow_storage
        self.task_id = task_id
        self.project_id = project_id
        
        super().__init__(
            name="Development Workflow",
            steps=[
                Condition(
                    name="Analysis Phase",
                    evaluator=self.should_run_analysis,
                    steps=[Step(name="Analyst", executor=self.run_analyst)]
                ),
                Condition(
                    name="Clarification Needed",
                    evaluator=self.should_run_clarification,
                    steps=[Step(name="Clarification Handler", executor=self.handle_clarification)]
                ),
                Condition(
                    name="Architecture Phase",
                    evaluator=self.should_run_architecture,
                    steps=[Step(name="Architect", executor=self.run_architect)]
                ),
                Condition(
                    name="Approval Pending",
                    evaluator=self.should_run_approval,
                    steps=[Step(name="Approval Handler", executor=self.handle_approval)]
                ),
                Condition(
                    name="Development Phase",
                    evaluator=self.should_run_development,
                    steps=[Step(name="Developer or Worker", executor=self.execute_development)]
                ),
                Condition(
                    name="Code Review Phase",
                    evaluator=self.should_run_code_review,
                    steps=[Step(name="Reviewer", executor=self.run_reviewer)]
                ),
                Condition(
                    name="DOD Check Phase",
                    evaluator=self.should_run_dod_check,
                    steps=[Step(name="Verifier", executor=self.run_verifier)]
                ),
                Condition(
                    name="Delivery Phase",
                    evaluator=self.should_run_delivery,
                    steps=[Step(name="Delivery Handler", executor=self.handle_delivery)]
                ),
                Condition(
                    name="Human Intervention",
                    evaluator=self.should_run_intervention,
                    steps=[Step(name="Intervention Handler", executor=self.handle_intervention)]
                ),
            ],
            *args, **kwargs
        )

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
                self.workflow_storage.save_workflow_state(self.task_id, new_state.model_dump())
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
             if role == "Analyst": artifact_type = "AnalystOutput"
             elif role == "Architect": artifact_type = "ArchitectPlan"
             elif role == "Reviewer": artifact_type = "ReviewVerdict"
             elif role == "Verifier": artifact_type = "FinalAcceptance"
             content = {"markdown": parsed_output}

        return self.workflow_storage.save_artifact(
            self.task_id, self.task_id, role, artifact_type, content
        )

    def _parse_agent_output(self, output: Any, schema_class: Type[BaseModel]) -> Any:
        try:
             if isinstance(output, schema_class) if isinstance(schema_class, type) else False:
                  return output
        except TypeError: pass

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
        if any(w in msg_lower for w in ["approve", "approved", "ok", "утверждаю", "да", "yes", "proceed"]):
            return "APPROVED"
        elif any(w in msg_lower for w in ["reject requirements", "change requirements", "wrong requirements"]):
            return "REJECTED_REQUIREMENTS"
        elif any(w in msg_lower for w in ["reject", "no", "change architecture", "wrong plan"]):
            return "REJECTED_ARCHITECTURE"
        return "WAITING"

    def _check_complexity(self) -> bool:
        if not self.workflow_storage or not self.task_id: return False
        try:
            plan_artifact = self.workflow_storage.get_artifact_by_task(self.task_id, "ArchitectPlan")
            if plan_artifact:
                content = plan_artifact.get("content", {})
                files = content.get("files_to_modify", []) + content.get("files_to_create", [])
                if len(files) > 2: return True
        except Exception: pass
        return False

    def _get_jules_session_id(self) -> Optional[str]:
        if not self.workflow_storage or not self.task_id: return None
        worker_artifact = self.workflow_storage.get_artifact_by_task(self.task_id, "JulesSession")
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
        return s == WorkflowStage.DELIVERY_HANDOFF or s == WorkflowStage.WAITING_FOR_USER_MERGE

    def should_run_intervention(self, step_input: StepInput) -> bool:
        return self._get_current_state().stage == WorkflowStage.NEED_HUMAN_INTERVENTION

    # --- Executors ---
    def run_analyst(self, step_input: StepInput) -> StepOutput:
        response = self.analyst.run(message=step_input.input)
        content = self._get_content_from_response(response)
        
        # State Transition Logic
        current_state = self._get_current_state()
        if self._is_clarification_response(response):
             questions = content.get("questions", []) if isinstance(content, dict) else []
             new_state = StateManager.transition(current_state, WorkflowStage.CLARIFICATION_NEEDED, {"questions": questions})
             self._update_state(new_state)
        else:
             # Assume success if not clarification
             artifact_id = self._save_artifact("Analyst", content)
             new_state = StateManager.transition(current_state, WorkflowStage.ARCHITECTURE, {"prd_id": artifact_id})
             self._update_state(new_state)
             
        return StepOutput(content=content, success=True)

    def handle_clarification(self, step_input: StepInput) -> StepOutput:
        current_state = self._get_current_state()
        try:
            # Transition to ANALYSIS
            prev_questions = current_state.questions if hasattr(current_state, "questions") else []
            new_state = StateManager.transition(current_state, WorkflowStage.ANALYSIS, {})
            self._update_state(new_state)
            
            # Construct context for next run
            context_override = f"\n[System] ACTION REQUIRED: Users clarified. Prev questions: {prev_questions}"
            return StepOutput(content=context_override, success=True)
        except Exception as e:
            return StepOutput(content=f"Error: {e}", success=False)

    def run_architect(self, step_input: StepInput) -> StepOutput:
        response = self.architect.run(message=step_input.input)
        content = self._get_content_from_response(response)
        
        artifact_id = self._save_artifact("Architect", content)
        current_state = self._get_current_state()
        new_state = StateManager.transition(current_state, WorkflowStage.APPROVAL_PENDING, {"plan_id": artifact_id})
        self._update_state(new_state)
        
        return StepOutput(content=content, success=True)

    def handle_approval(self, step_input: StepInput) -> StepOutput:
        message = step_input.input or ""
        approval = self._check_user_approval(message)
        current_state = self._get_current_state()
        
        if approval == "APPROVED":
            new_state = StateManager.transition(current_state, WorkflowStage.DEVELOPMENT, {})
            self._update_state(new_state)
            return StepOutput(content="APPROVED", success=True)
        elif approval == "REJECTED_REQUIREMENTS":
            new_state = StateManager.transition(current_state, WorkflowStage.ANALYSIS, {})
            self._update_state(new_state)
            return StepOutput(content="Requirements Rejected", success=True)
        elif approval == "REJECTED_ARCHITECTURE":
            new_state = StateManager.transition(current_state, WorkflowStage.ARCHITECTURE, {})
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
                return StepOutput(content=f"Jules running task {session_id}", success=True)
            
            response = self.worker.run(message=step_input.input)
            content = self._get_content_from_response(response)
            
            # Check if session started
            sess_id = None
            if isinstance(content, dict): sess_id = content.get("session_id")
            
            if sess_id:
                context_updates = {"jules_task_id": sess_id}
                # Stay in Development? Or what?
                # Usually Jules runs async. We stay in Development until webhook updates us.
                # So we just update state with ID?
                # StateManager.transition(..., DEVELOPMENT, ...) is valid (loops).
                # But we just need to save the ID.
                # Let's save artifact "JulesSession"
                self._save_artifact("Worker", content)
                new_state = StateManager.transition(current_state, WorkflowStage.DEVELOPMENT, context_updates) # Re-enter dev with ID
                self._update_state(new_state)
            
            return StepOutput(content=content, success=True)
        else:
             response = self.developer.run(message=step_input.input)
             content = self._get_content_from_response(response)
             
             # Check for PR URL
             pr_url = None
             if isinstance(content, dict): pr_url = content.get("pr_url")
             if isinstance(content, str):
                 match = re.search(r'https://github\.com/[^\s]+/pull/\d+', content)
                 if match: pr_url = match.group(0)
             
             if pr_url:
                 new_state = StateManager.transition(current_state, WorkflowStage.CODE_REVIEW, {"pr_url": pr_url})
                 self._update_state(new_state)
             
             return StepOutput(content=content, success=True)

    def run_reviewer(self, step_input: StepInput) -> StepOutput:
        response = self.reviewer.run(message=step_input.input)
        content = self._get_content_from_response(response)
        
        artifact_id = self._save_artifact("Reviewer", content)
        current_state = self._get_current_state()
        
        # Parse verdict
        verdict = "REJECT"
        if isinstance(content, str) and "Status: Approved" in content: verdict = "APPROVED"
        
        # Add history
        review_entry = ReviewHistoryEntry(role="Reviewer", status=verdict, comment=str(content)[:100])
        # Manually add to list since StateManager.add_review_entry returns new state object but we need to pass it to transition
        # Done via context updates? No, state model has it.
        # We need to update current_state first.
        current_state.review_history.append(review_entry)
        
        if verdict == "APPROVED":
             new_state = StateManager.transition(current_state, WorkflowStage.DOD_CHECK, {"review_verdict_id": artifact_id})
        else:
             # Check retries
             if current_state.retry_count >= MAX_RETRY_COUNT:
                  new_state = StateManager.transition(current_state, WorkflowStage.NEED_HUMAN_INTERVENTION, {"reason": "Max retries"})
             else:
                  current_state.retry_count += 1
                  new_state = StateManager.transition(current_state, WorkflowStage.DEVELOPMENT, {"retry_count": current_state.retry_count})
        
        self._update_state(new_state)
        return StepOutput(content=content, success=True)

    def run_verifier(self, step_input: StepInput) -> StepOutput:
        response = self.verifier.run(message=step_input.input)
        content = self._get_content_from_response(response)
        
        self._save_artifact("Verifier", content)
        current_state = self._get_current_state()
        
        is_pass = False
        if isinstance(content, str) and ("Status: PASS" in content or "**Status**: PASS" in content):
             is_pass = True
        
        if is_pass:
             new_state = StateManager.transition(current_state, WorkflowStage.DELIVERY_HANDOFF, {})
        else:
             new_state = StateManager.transition(current_state, WorkflowStage.DEVELOPMENT, {})
        
        self._update_state(new_state)
        return StepOutput(content=content, success=True)
    
    def handle_delivery(self, step_input: StepInput) -> StepOutput:
         current_state = self._get_current_state()
         if current_state.stage == WorkflowStage.DELIVERY_HANDOFF:
             # Create report
             report = "Final Report Generated."
             new_state = StateManager.transition(current_state, WorkflowStage.WAITING_FOR_USER_MERGE, {"final_report": report})
             self._update_state(new_state)
             return StepOutput(content=report, success=True)
         
         return StepOutput(content="Waiting for User Merge", success=True)

    def handle_intervention(self, step_input: StepInput) -> StepOutput:
        return StepOutput(content="Human Intervention Required", success=True)
