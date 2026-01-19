from enum import Enum
from typing import Optional, List, Literal, Union, Dict, Any
from pydantic import BaseModel, Field, ValidationError


class WorkflowStage(str, Enum):
    """Workflow stages for the Development Team State Machine"""
    ANALYSIS = "analysis"
    CLARIFICATION_NEEDED = "clarification_needed"
    ARCHITECTURE = "architecture"
    APPROVAL_PENDING = "approval_pending"
    DEVELOPMENT = "development"
    CODE_REVIEW = "code_review"
    DOD_CHECK = "dod_check"
    DELIVERY_HANDOFF = "delivery_handoff"
    WAITING_FOR_USER_MERGE = "waiting_for_user_merge"
    NEED_HUMAN_INTERVENTION = "need_human_intervention"
    DONE = "done"


class WorkflowStatus(str, Enum):
    IN_PROGRESS = "in_progress"
    WAITING_FOR_USER = "waiting_for_user"
    COMPLETED = "completed"
    FAILED = "failed"
    BLOCKED = "blocked"


class ReviewHistoryEntry(BaseModel):
    """Single entry in the review history"""
    role: str = Field(..., description="Role that performed the review (e.g., 'Reviewer')")
    status: Literal["APPROVED", "REJECT"] = Field(..., description="Review verdict")
    comment: str = Field(..., description="Review comment or feedback")
    timestamp: Optional[str] = Field(None, description="ISO timestamp of the review")


class BaseState(BaseModel):
    stage: WorkflowStage
    status: WorkflowStatus = WorkflowStatus.IN_PROGRESS
    last_error: Optional[str] = None
    retry_count: int = Field(0, description="Number of retries for review loops")
    review_history: List[ReviewHistoryEntry] = Field(default_factory=list)

    prd_id: Optional[str] = None
    plan_id: Optional[str] = None
    user_prompt: Optional[str] = None


class AnalysisState(BaseState):
    stage: Literal[WorkflowStage.ANALYSIS] = WorkflowStage.ANALYSIS
    clarification_questions: Optional[List[str]] = None


class ClarificationNeededState(BaseState):
    stage: Literal[WorkflowStage.CLARIFICATION_NEEDED] = WorkflowStage.CLARIFICATION_NEEDED
    status: WorkflowStatus = WorkflowStatus.WAITING_FOR_USER
    questions: List[str] = Field(..., description="Questions requiring user input")
    context: Optional[str] = None


class ArchitectureState(BaseState):
    stage: Literal[WorkflowStage.ARCHITECTURE] = WorkflowStage.ARCHITECTURE
    prd_id: str


class ApprovalPendingState(BaseState):
    stage: Literal[WorkflowStage.APPROVAL_PENDING] = WorkflowStage.APPROVAL_PENDING
    status: WorkflowStatus = WorkflowStatus.WAITING_FOR_USER
    prd_id: str
    plan_id: str
    approval_request_summary: Optional[str] = None


class DevelopmentState(BaseState):
    stage: Literal[WorkflowStage.DEVELOPMENT] = WorkflowStage.DEVELOPMENT
    prd_id: str
    plan_id: str
    branch_name: Optional[str] = None
    pr_url: Optional[str] = None
    session_id: Optional[str] = None
    jules_task_id: Optional[str] = None


class CodeReviewState(BaseState):
    stage: Literal[WorkflowStage.CODE_REVIEW] = WorkflowStage.CODE_REVIEW
    prd_id: str
    plan_id: str
    pr_url: str
    code_diff: Optional[str] = None
    review_verdict_id: Optional[str] = None


class DODCheckState(BaseState):
    stage: Literal[WorkflowStage.DOD_CHECK] = WorkflowStage.DOD_CHECK
    prd_id: str
    plan_id: str
    pr_url: str
    review_verdict_id: str
    test_results: Optional[Dict[str, Any]] = None
    lint_results: Optional[Dict[str, Any]] = None


class DeliveryHandoffState(BaseState):
    stage: Literal[WorkflowStage.DELIVERY_HANDOFF] = WorkflowStage.DELIVERY_HANDOFF
    prd_id: str
    plan_id: str
    pr_url: str
    final_report: Optional[str] = None


class WaitingForUserMergeState(BaseState):
    stage: Literal[WorkflowStage.WAITING_FOR_USER_MERGE] = WorkflowStage.WAITING_FOR_USER_MERGE
    status: WorkflowStatus = WorkflowStatus.WAITING_FOR_USER
    prd_id: str
    plan_id: str
    pr_url: str
    final_report: str


class NeedHumanInterventionState(BaseState):
    stage: Literal[WorkflowStage.NEED_HUMAN_INTERVENTION] = WorkflowStage.NEED_HUMAN_INTERVENTION
    status: WorkflowStatus = WorkflowStatus.BLOCKED
    reason: str = Field(..., description="Reason for requiring human intervention")
    prd_id: Optional[str] = None
    plan_id: Optional[str] = None
    plan_id: Optional[str] = None
    pr_url: Optional[str] = None


class DoneState(BaseState):
    stage: Literal[WorkflowStage.DONE] = WorkflowStage.DONE
    status: WorkflowStatus = WorkflowStatus.COMPLETED
    prd_id: Optional[str] = None


WorkflowState = Union[
    AnalysisState,
    ClarificationNeededState,
    ArchitectureState,
    ApprovalPendingState,
    DevelopmentState,
    CodeReviewState,
    DODCheckState,
    DeliveryHandoffState,
    WaitingForUserMergeState,
    WaitingForUserMergeState,
    NeedHumanInterventionState,
    DoneState,
]


ALLOWED_TRANSITIONS: Dict[WorkflowStage, List[WorkflowStage]] = {
    WorkflowStage.ANALYSIS: [
        WorkflowStage.CLARIFICATION_NEEDED,
        WorkflowStage.ARCHITECTURE,
        WorkflowStage.DONE,
    ],
    WorkflowStage.CLARIFICATION_NEEDED: [
        WorkflowStage.ANALYSIS,
    ],
    WorkflowStage.ARCHITECTURE: [
        WorkflowStage.APPROVAL_PENDING,
    ],
    WorkflowStage.APPROVAL_PENDING: [
        WorkflowStage.DEVELOPMENT,
        WorkflowStage.ANALYSIS,
        WorkflowStage.ARCHITECTURE,
    ],
    WorkflowStage.DEVELOPMENT: [
        WorkflowStage.CODE_REVIEW,
    ],
    WorkflowStage.CODE_REVIEW: [
        WorkflowStage.DEVELOPMENT,
        WorkflowStage.DOD_CHECK,
        WorkflowStage.NEED_HUMAN_INTERVENTION,
    ],
    WorkflowStage.DOD_CHECK: [
        WorkflowStage.DEVELOPMENT,
        WorkflowStage.DELIVERY_HANDOFF,
    ],
    WorkflowStage.DELIVERY_HANDOFF: [
        WorkflowStage.WAITING_FOR_USER_MERGE,
    ],
    WorkflowStage.WAITING_FOR_USER_MERGE: [],
    WorkflowStage.NEED_HUMAN_INTERVENTION: [
        WorkflowStage.DEVELOPMENT,
        WorkflowStage.ANALYSIS,
    ],
}

MAX_RETRY_COUNT = 3


class StateManager:
    """
    Helper class to manage transitions between states.
    It doesn't store state itself, but transforms one state model to another.
    """

    @staticmethod
    def get_initial_state(user_prompt: Optional[str] = None) -> WorkflowState:
        return AnalysisState(
            status=WorkflowStatus.IN_PROGRESS,
            user_prompt=user_prompt,
        )

    @staticmethod
    def validate_transition(
        current_stage: WorkflowStage,
        target_stage: WorkflowStage,
    ) -> bool:
        """Validates if a transition from current_stage to target_stage is allowed."""
        allowed = ALLOWED_TRANSITIONS.get(current_stage, [])
        return target_stage in allowed

    @staticmethod
    def increment_retry(current_state: WorkflowState) -> WorkflowState:
        """Increments retry count and returns updated state."""
        current_state.retry_count += 1
        return current_state

    @staticmethod
    def should_escalate_to_human(current_state: WorkflowState) -> bool:
        """Checks if the retry count exceeds the maximum allowed."""
        return current_state.retry_count > MAX_RETRY_COUNT

    @staticmethod
    def add_review_entry(
        current_state: WorkflowState,
        role: str,
        status: Literal["APPROVED", "REJECT"],
        comment: str,
    ) -> WorkflowState:
        """Adds a review history entry to the current state."""
        from datetime import datetime
        entry = ReviewHistoryEntry(
            role=role,
            status=status,
            comment=comment,
            timestamp=datetime.utcnow().isoformat(),
        )
        current_state.review_history.append(entry)
        return current_state

    @staticmethod
    def transition(
        current_state: WorkflowState,
        target_stage: WorkflowStage,
        context_updates: Dict[str, Any],
    ) -> WorkflowState:
        """
        Transitions from current_state to target_stage using context_updates.
        Validates that necessary artifacts exist in the current state or updates.
        """
        if not StateManager.validate_transition(current_state.stage, target_stage):
            raise ValueError(
                f"Invalid transition from {current_state.stage} to {target_stage}. "
                f"Allowed transitions: {ALLOWED_TRANSITIONS.get(current_state.stage, [])}"
            )

        base_data = current_state.model_dump(
            exclude={"stage", "status", "last_error"}
        )
        next_data = {**base_data, **context_updates}

        try:
            if target_stage == WorkflowStage.ANALYSIS:
                return AnalysisState(**next_data, status=WorkflowStatus.IN_PROGRESS)

            elif target_stage == WorkflowStage.CLARIFICATION_NEEDED:
                questions = context_updates.get("questions", [])
                return ClarificationNeededState(
                    **next_data,
                    questions=questions,
                    status=WorkflowStatus.WAITING_FOR_USER,
                )

            elif target_stage == WorkflowStage.ARCHITECTURE:
                return ArchitectureState(**next_data, status=WorkflowStatus.IN_PROGRESS)

            elif target_stage == WorkflowStage.APPROVAL_PENDING:
                return ApprovalPendingState(
                    **next_data, status=WorkflowStatus.WAITING_FOR_USER
                )

            elif target_stage == WorkflowStage.DEVELOPMENT:
                next_data.pop("questions", None)
                next_data.pop("context", None)
                return DevelopmentState(**next_data, status=WorkflowStatus.IN_PROGRESS)

            elif target_stage == WorkflowStage.CODE_REVIEW:
                return CodeReviewState(**next_data, status=WorkflowStatus.IN_PROGRESS)

            elif target_stage == WorkflowStage.DOD_CHECK:
                return DODCheckState(**next_data, status=WorkflowStatus.IN_PROGRESS)

            elif target_stage == WorkflowStage.DELIVERY_HANDOFF:
                return DeliveryHandoffState(
                    **next_data, status=WorkflowStatus.IN_PROGRESS
                )

            elif target_stage == WorkflowStage.WAITING_FOR_USER_MERGE:
                return WaitingForUserMergeState(
                    **next_data, status=WorkflowStatus.WAITING_FOR_USER
                )

            elif target_stage == WorkflowStage.NEED_HUMAN_INTERVENTION:
                reason = context_updates.get(
                    "reason", f"Exceeded max retry count ({MAX_RETRY_COUNT})"
                )
                return NeedHumanInterventionState(
                    **next_data,
                    reason=reason,
                    status=WorkflowStatus.BLOCKED,
                )

            elif target_stage == WorkflowStage.DONE:
                return DoneState(**next_data)

            else:
                raise ValueError(f"Unknown target stage: {target_stage}")

        except ValidationError as e:
            raise ValueError(f"Invalid transition to {target_stage}: {e}")
