"""plan.build command — wraps build_planning_workflow() for slash-command invocation.

The planning workflow is a sync generator (_planning_steps) iterated directly.
We run it in a thread via asyncio.to_thread so the event loop stays unblocked.
The final plan document lives in workflow.session_state after the BUILD stage.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date as date_cls

from pydantic import BaseModel, Field

from src.commands.base import CommandResult, command
from src.commands.context import CommandContext

logger = logging.getLogger(__name__)


class PlanBuildArgs(BaseModel):
    date: date_cls = Field(..., description="Plan target date (YYYY-MM-DD)")
    freeform: str = Field(..., min_length=1, description="Natural-language task list")


async def _run_workflow(args: PlanBuildArgs, ctx: CommandContext) -> dict:
    """Thin wrapper around build_planning_workflow() so tests can monkeypatch it.

    The real workflow uses a sync generator (_planning_steps). We iterate it
    in a thread to avoid blocking the event loop. The plan document is stored
    in workflow.session_state after the BUILD stage completes.
    """
    from agno.workflow.types import WorkflowExecutionInput

    from src.workflows.planning import PlanningInput as WorkflowPlanningInput
    from src.workflows.planning import _planning_steps as _run_planning_steps
    from src.workflows.planning import build_planning_workflow

    session_state: dict = {
        "planning_date": args.date.isoformat(),
        "status": None,
    }

    workflow = build_planning_workflow(
        session_id=ctx.session_id or ctx.chat_id or "command",
        session_state=session_state,
    )

    planning_input = WorkflowPlanningInput(
        planning_date=args.date.isoformat(),
        tasks=[],
    )
    execution_input = WorkflowExecutionInput(
        input=args.freeform,
        additional_data={"planning_input": planning_input},
    )

    def _iterate() -> None:
        for step in _run_planning_steps(workflow, execution_input):
            step_name = getattr(step, "step_name", "unknown")
            logger.info("[plan.build] step=%s", step_name)

    await asyncio.to_thread(_iterate)

    final_state = workflow.session_state or {}
    document = final_state.get("plan_document") or final_state.get("document")
    return {"document": document}


@command(
    name="plan.build",
    title="Build day plan",
    description="Build a structured day plan from a free-form task list.",
    args_model=PlanBuildArgs,
    requires=(),
    surface="chat",
)
async def plan_build(args: PlanBuildArgs, ctx: CommandContext) -> CommandResult:
    try:
        doc = await _run_workflow(args, ctx)
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.exception("plan.build workflow failed")
        return CommandResult.error(code="workflow_failed", message=str(e))
    return CommandResult.ok(text="Plan ready.", data={"document": doc.get("document")})
