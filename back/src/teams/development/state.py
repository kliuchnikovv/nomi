from enum import Enum
from typing import Optional, List, Literal, Union, Dict, Any
from pydantic import BaseModel, Field, ValidationError

class WorkflowStage(str, Enum):
    ANALYSIS = "analysis"
    ARCHITECTURE = "architecture"
    CODING = "coding"
    REVIEW = "review"
    VERIFICATION = "verification"
    DONE = "done"

class WorkflowStatus(str, Enum):
    IN_PROGRESS = "in_progress"
    WAITING_FOR_USER = "waiting_for_user"
    COMPLETED = "completed"
    FAILED = "failed"

class BaseState(BaseModel):
    stage: WorkflowStage
    status: WorkflowStatus = WorkflowStatus.IN_PROGRESS
    last_error: Optional[str] = None

    # Common artifacts (ids) that accumulate
    prd_id: Optional[str] = None
    plan_id: Optional[str] = None

class AnalysisState(BaseState):
    stage: Literal[WorkflowStage.ANALYSIS] = WorkflowStage.ANALYSIS
    # Analysis specific fields

class ArchitectureState(BaseState):
    stage: Literal[WorkflowStage.ARCHITECTURE] = WorkflowStage.ARCHITECTURE
    # Architecture requires PRD
    prd_id: str

class CodingState(BaseState):
    stage: Literal[WorkflowStage.CODING] = WorkflowStage.CODING
    prd_id: str
    plan_id: str
    branch_name: Optional[str] = None
    pr_url: Optional[str] = None
    session_id: Optional[str] = None

class ReviewState(BaseState):
    stage: Literal[WorkflowStage.REVIEW] = WorkflowStage.REVIEW
    prd_id: str
    plan_id: str
    pr_url: str
    review_verdict_id: Optional[str] = None

class VerificationState(BaseState):
    stage: Literal[WorkflowStage.VERIFICATION] = WorkflowStage.VERIFICATION
    prd_id: str
    plan_id: str
    pr_url: str
    review_verdict_id: str

class DoneState(BaseState):
    stage: Literal[WorkflowStage.DONE] = WorkflowStage.DONE
    prd_id: str
    plan_id: str
    pr_url: str

# Union type for polymorphism
WorkflowState = Union[
    AnalysisState,
    ArchitectureState,
    CodingState,
    ReviewState,
    VerificationState,
    DoneState
]

class StateManager:
    """
    Helper class to manage transitions between states.
    It doesn't store state itself, but transforms one state model to another.
    """

    @staticmethod
    def get_initial_state() -> WorkflowState:
        return AnalysisState(status=WorkflowStatus.IN_PROGRESS)

    @staticmethod
    def transition(
        current_state: WorkflowState,
        target_stage: WorkflowStage,
        context_updates: Dict[str, Any]
    ) -> WorkflowState:
        """
        Transitions from current_state to target_stage using context_updates.
        Validates that necessary artifacts exist in the current state or updates.
        """

        # 1. Merge current data with updates
        # We start with the dict representation of the current state
        # but filter out 'stage' and 'status' as they will be set by the new class
        # effectively "carrying over" accumulated artifact IDs.
        base_data = current_state.model_dump(exclude={'stage', 'status', 'last_error'})

        # Apply updates (e.g. setting new artifact IDs)
        next_data = {**base_data, **context_updates}

        # 2. Instantiate new state class
        # Pydantic validation will ensure required fields (like prd_id for Architecture) are present.
        try:
            if target_stage == WorkflowStage.ANALYSIS:
                return AnalysisState(**next_data, status=WorkflowStatus.IN_PROGRESS)

            elif target_stage == WorkflowStage.ARCHITECTURE:
                # Requires prd_id
                return ArchitectureState(**next_data, status=WorkflowStatus.IN_PROGRESS)

            elif target_stage == WorkflowStage.CODING:
                # Requires prd_id, plan_id
                return CodingState(**next_data, status=WorkflowStatus.IN_PROGRESS)

            elif target_stage == WorkflowStage.REVIEW:
                # Requires pr_url
                return ReviewState(**next_data, status=WorkflowStatus.IN_PROGRESS)

            elif target_stage == WorkflowStage.VERIFICATION:
                return VerificationState(**next_data, status=WorkflowStatus.IN_PROGRESS)

            elif target_stage == WorkflowStage.DONE:
                return DoneState(**next_data, status=WorkflowStatus.COMPLETED)

            else:
                raise ValueError(f"Unknown target stage: {target_stage}")

        except ValidationError as e:
            raise ValueError(f"Invalid transition to {target_stage}: {e}")
