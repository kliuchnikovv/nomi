from unittest.mock import patch
from agno.workflow import Workflow
from agno.workflow.types import WorkflowExecutionInput

from src.workflows.planning import _planning_steps
from src.workflows.models import PlanStatus, PlanningInput, PlanTask, StageResult


def _make_workflow(status: str = PlanStatus.EXTRACT, extra_state: dict | None = None) -> Workflow:
    state = {"status": status}
    if extra_state:
        state.update(extra_state)
    return Workflow(session_state=state, telemetry=False)


def _make_input(message: str, tasks: list | None = None, date: str = "2026-04-05") -> WorkflowExecutionInput:
    pi = PlanningInput(
        user_message=message,
        chat_id="chat-1",
        user_id="user-1",
        planning_date=date,
        tasks=[PlanTask(id="t1", title="Test task")] if tasks is None else tasks,
    )
    return WorkflowExecutionInput(
        input=message,
        additional_data={"planning_input": pi},
    )


def test_extract_stage_fires_first_on_new_session():
    wf = _make_workflow(PlanStatus.EXTRACT)
    with patch("src.workflows.planning._run_extract_stage") as mock_extract:
        mock_extract.return_value = StageResult(
            output={"extracted_tasks": [{"id": "t1"}]},
            pending_questions=[],
        )
        list(_planning_steps(wf, _make_input("план на день")))
    mock_extract.assert_called_once()
    assert wf.session_state["status"] == PlanStatus.RECON


def test_clarification_loop_pauses_on_pending_question():
    wf = _make_workflow(PlanStatus.EXTRACT)
    with patch("src.workflows.planning._run_extract_stage") as mock_extract:
        mock_extract.return_value = StageResult(
            output={"extracted_tasks": []},
            pending_questions=["Во сколько зал?"],
        )
        steps = list(_planning_steps(wf, _make_input("план")))
    # Should yield one StepOutput with the question and set status to CLARIFYING
    assert wf.session_state["status"] == PlanStatus.CLARIFYING
    assert wf.session_state["pending_stage"] == PlanStatus.EXTRACT
    assert len(steps) == 1
    assert "зал" in steps[0].content


def test_clarification_answer_returns_to_stage():
    state = {
        "status": PlanStatus.CLARIFYING,
        "pending_stage": PlanStatus.EXTRACT,
        "pending_questions": [],  # all answered
        "clarification_answers": ["В 10:00"],
        "tasks": [{"id": "t1", "title": "Зал"}],
        "planning_date": "2026-04-05",
        "extract_clarified": False,
    }
    wf = _make_workflow(extra_state=state)
    with patch("src.workflows.planning._run_extract_stage") as mock_extract:
        mock_extract.return_value = StageResult(
            output={"extracted_tasks": [{"id": "t1", "time_hint": "10:00"}]},
            pending_questions=[],
        )
        list(_planning_steps(wf, _make_input("В 10:00")))
    # Should re-run EXTRACT then advance to RECON
    mock_extract.assert_called_once()
    assert wf.session_state["status"] == PlanStatus.RECON


def test_build_patches_stored_in_session_state():
    state = {
        "status": PlanStatus.BUILD,
        "tasks": [{"id": "t1", "title": "Встреча", "time_hint": "14:00", "location": "office", "context_type": "place"}],
        "planning_date": "2026-04-05",
        "timezone": "UTC",
        "extract_output": {"extracted_tasks": [{"id": "t1"}]},
        "recon_output": {"locations": {"office": {"coords": (37.6, 55.7), "hours": ""}}, "transport_mode": "walking"},
        "cluster_output": {"clusters": [{"location": "office", "context_type": "place", "task_ids": ["t1"]}]},
        "route_output": {"travel_blocks": []},
    }
    wf = _make_workflow(extra_state=state)
    with patch("src.workflows.planning._run_build_stage") as mock_build:
        mock_build.return_value = StageResult(output={"patches": [{"op": "add_chip"}], "summary": "done"})
        list(_planning_steps(wf, _make_input("build")))
    assert "plan_patches" in wf.session_state
    assert wf.session_state["status"] == PlanStatus.REVIEW
