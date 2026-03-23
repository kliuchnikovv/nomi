"""Day Planner Workflow.

Architecture:
  - Uses Agno 2.4.0 Workflow (dataclass-based) with a callable ``steps`` function.
  - ``session_state`` persists planning progress between turns via workflow.session_state.
  - The steps callable is a sync generator that yields StepOutput objects.
  - Each status maps to a planning phase:
      gathering  → ask clarifying questions / search context
      building   → produce two draft schedule variants
      review     → present draft to user, handle approval/change requests
      committed  → plan confirmed, create reminders via client_action
      replanning → reschedule remaining blocks mid-day
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any, Iterator

from agno.workflow import Workflow
from agno.workflow.types import StepOutput, WorkflowExecutionInput

from .models import PlanningInput, PlanStatus
from .tools import search_place_hours, search_route_time, search_weather

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────


def _build_model() -> Any:
    """Build the Gemini model used by planning agents."""
    from agno.models.google import Gemini  # type: ignore[import]

    api_key = os.getenv("GOOGLE_API_KEY", "")
    return Gemini(id="gemini-2.0-flash", api_key=api_key)


def _run_agent_text(system_prompt: str, user_prompt: str) -> str:
    """Run a one-shot agent and return the text response."""
    try:
        from agno.agent import Agent

        model = _build_model()
        agent = Agent(
            model=model,
            instructions=system_prompt,
            stream=False,
            telemetry=False,
        )
        result = agent.run(user_prompt, stream=False)
        content = getattr(result, "content", None) or ""
        return str(content)
    except Exception as exc:
        logger.warning("[PlanningWorkflow] Agent run failed: %s", exc)
        return f"(agent error: {exc})"


def _gather_context_text(
    tasks: list[dict],
    planning_date: str,
    timezone: str,
    user_message: str,
) -> str:
    """Gather context about tasks using search tools and an agent."""
    # Collect search results for tasks that have locations
    search_snippets: list[str] = []
    for task in tasks:
        location = task.get("location")
        if location:
            try:
                hours = search_place_hours(location, planning_date)
                search_snippets.append(f"Hours for {location}: {hours[:300]}")
            except Exception:
                pass

    # Weather for the first task location or generic
    try:
        first_loc = next(
            (t.get("location") for t in tasks if t.get("location")), "the city"
        )
        weather = search_weather(first_loc or "the city", planning_date)
        search_snippets.append(f"Weather: {weather[:300]}")
    except Exception:
        pass

    # Route times between consecutive tasks with locations
    locations = [t.get("location") for t in tasks if t.get("location")]
    for i in range(len(locations) - 1):
        try:
            route = search_route_time(
                str(locations[i]), str(locations[i + 1])
            )
            search_snippets.append(
                f"Travel {locations[i]} → {locations[i + 1]}: {route[:200]}"
            )
        except Exception:
            pass

    search_context = "\n".join(search_snippets) if search_snippets else "No search data available."

    tasks_json = json.dumps(tasks, ensure_ascii=False)
    system_prompt = (
        "You are a helpful day planner assistant. "
        "Your job is to gather context for the user's tasks and ask clarifying questions "
        "about unclear durations, locations, or constraints. "
        "Be concise and friendly."
    )
    user_prompt = (
        f"Planning date: {planning_date} (timezone: {timezone})\n"
        f"Tasks: {tasks_json}\n"
        f"Search context:\n{search_context}\n\n"
        f"User message: {user_message}\n\n"
        "Summarise the context you have gathered and ask any clarifying questions "
        "needed before building the schedule (missing durations, locations, priorities)."
    )
    return _run_agent_text(system_prompt, user_prompt)


def _build_draft_plans_text(
    tasks: list[dict],
    context: dict,
    planning_date: str,
    timezone: str,
    user_message: str,
) -> tuple[str, list[list[dict]]]:
    """Ask the scheduler agent to produce two plan variants. Returns (text, draft_plans)."""
    tasks_json = json.dumps(tasks, ensure_ascii=False)
    context_json = json.dumps(context, ensure_ascii=False)
    system_prompt = (
        "You are an expert day scheduler. "
        "Given a list of tasks with optional locations, durations, and notes, "
        "create exactly 2 optimised day schedules. "
        "Return ONLY a JSON array of 2 arrays, each containing PlanBlock objects. "
        "PlanBlock schema: {id, title, start (HH:MM), end (HH:MM), duration_min, "
        "location (optional), travel_before_min (int, default 0), "
        'type (task|travel|buffer|break), task_id (optional), notes (optional)}. '
        "Do not include any explanation outside the JSON."
    )
    user_prompt = (
        f"Planning date: {planning_date} (timezone: {timezone})\n"
        f"Tasks: {tasks_json}\n"
        f"Context: {context_json}\n"
        f"User message: {user_message}\n\n"
        "Produce 2 schedule variants as a JSON array of arrays."
    )
    raw = _run_agent_text(system_prompt, user_prompt)
    draft_plans: list[list[dict]] = []
    try:
        start = raw.find("[")
        end = raw.rfind("]") + 1
        if start >= 0 and end > start:
            parsed = json.loads(raw[start:end])
            if isinstance(parsed, list):
                for variant in parsed:
                    if isinstance(variant, list):
                        draft_plans.append(variant)
    except Exception as exc:
        logger.warning("[PlanningWorkflow] Failed to parse draft plans JSON: %s", exc)

    if not draft_plans:
        # Fallback: single stub plan
        blocks = []
        for task in tasks:
            block_id = str(uuid.uuid4())[:8]
            blocks.append(
                {
                    "id": block_id,
                    "title": task.get("title", "Task"),
                    "start": "09:00",
                    "end": "10:00",
                    "duration_min": task.get("duration_min") or 60,
                    "location": task.get("location"),
                    "travel_before_min": 0,
                    "type": "task",
                    "task_id": task.get("id"),
                    "notes": task.get("notes"),
                }
            )
        draft_plans = [blocks]

    # Present the first variant as human-readable text
    lines = ["Here are two schedule options for your day:\n"]
    for i, variant in enumerate(draft_plans[:2], 1):
        lines.append(f"**Option {i}:**")
        for block in variant:
            start_t = block.get("start", "?")
            end_t = block.get("end", "?")
            title = block.get("title", "")
            loc = block.get("location", "")
            travel = block.get("travel_before_min", 0)
            line = f"  {start_t}–{end_t}  {title}"
            if loc:
                line += f" @ {loc}"
            if travel:
                line += f" (travel: {travel} min)"
            lines.append(line)
        lines.append("")

    lines.append("Which option do you prefer? You can also ask for changes.")
    return "\n".join(lines), draft_plans


def _review_and_commit(
    user_message: str,
    draft_plans: list[list[dict]],
    session_state: dict,
) -> tuple[str, str]:
    """Handle review step. Returns (response_text, new_status)."""
    msg_lower = user_message.lower()
    approval_words = {"yes", "ok", "okay", "looks good", "approve", "confirm", "go ahead", "perfect", "great", "option 1", "first", "second", "option 2"}

    if any(word in msg_lower for word in approval_words):
        # User approves – pick a variant based on "option 1/2" or default to first
        chosen = draft_plans[0] if draft_plans else []
        if "option 2" in msg_lower or "second" in msg_lower:
            chosen = draft_plans[1] if len(draft_plans) > 1 else chosen

        session_state["plan"] = chosen
        response = (
            "Great! Your day plan has been confirmed. "
            "I'll create reminders for each block now.\n\n"
        )
        # List the committed blocks
        for block in chosen:
            start_t = block.get("start", "")
            title = block.get("title", "")
            response += f"- {start_t}  {title}\n"
        response += "\nAll set! Have a productive day."
        return response, PlanStatus.COMMITTED

    # Otherwise, treat as change request → rebuild
    session_state["user_change_request"] = user_message
    return (
        "Got it! Let me adjust the schedule based on your feedback and rebuild the plan.",
        PlanStatus.BUILDING,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Workflow steps callable (sync generator)
# ──────────────────────────────────────────────────────────────────────────────


def _planning_steps(
    workflow: Workflow,
    execution_input: WorkflowExecutionInput,
    **kwargs: Any,
) -> Iterator[StepOutput]:
    """Main planning workflow generator.

    Called by Agno for each run. Routes to the appropriate planning phase
    based on session_state["status"].
    """
    # Extract planning_input from additional_data or input
    planning_input: PlanningInput | None = None
    if execution_input.additional_data and "planning_input" in execution_input.additional_data:
        raw = execution_input.additional_data["planning_input"]
        if isinstance(raw, PlanningInput):
            planning_input = raw
        elif isinstance(raw, dict):
            planning_input = PlanningInput(**raw)

    user_message: str = ""
    if execution_input.input:
        if isinstance(execution_input.input, str):
            user_message = execution_input.input
        else:
            user_message = str(execution_input.input)

    # Initialise session_state on workflow if not yet set
    if workflow.session_state is None:
        workflow.session_state = {}

    state: dict = workflow.session_state
    status: str = state.get("status", PlanStatus.GATHERING)

    planning_date: str = ""
    tasks: list[dict] = []
    timezone: str = "UTC"

    if planning_input:
        planning_date = planning_input.planning_date
        tasks = [t.model_dump() for t in planning_input.tasks] or state.get("tasks", [])
        timezone = planning_input.timezone
    else:
        planning_date = state.get("planning_date", "")
        tasks = state.get("tasks", [])

    # Persist current tasks/date in session_state
    if planning_date:
        state["planning_date"] = planning_date
    if tasks:
        state["tasks"] = tasks

    logger.info(
        "[PlanningWorkflow] status=%s user_message=%r planning_date=%s tasks=%d",
        status,
        user_message[:60],
        planning_date,
        len(tasks),
    )

    # ── GATHERING ──────────────────────────────────────────────────────────
    if status == PlanStatus.GATHERING:
        try:
            response_text = _gather_context_text(tasks, planning_date, timezone, user_message)
            # Advance to building phase after context gathered
            state["status"] = PlanStatus.BUILDING
            state["context"] = {"gathered": True, "summary": response_text[:500]}
        except Exception as exc:
            logger.error("[PlanningWorkflow] Gather context failed: %s", exc)
            response_text = (
                "I'm ready to help plan your day! Please tell me what tasks you have, "
                "their durations, and any locations you need to visit."
            )
            state["status"] = PlanStatus.BUILDING

        yield StepOutput(step_name="gather_context", content=response_text)
        return

    # ── BUILDING ───────────────────────────────────────────────────────────
    if status in (PlanStatus.BUILDING, PlanStatus.REPLANNING):
        try:
            context = state.get("context", {})
            response_text, draft_plans = _build_draft_plans_text(
                tasks, context, planning_date, timezone, user_message
            )
            state["draft_plans"] = draft_plans
            state["status"] = PlanStatus.REVIEW
        except Exception as exc:
            logger.error("[PlanningWorkflow] Build plan failed: %s", exc)
            response_text = (
                "I had trouble building the schedule. "
                "Could you provide more details about your tasks (duration, location)?"
            )
            state["status"] = PlanStatus.GATHERING

        yield StepOutput(step_name="build_plan", content=response_text)
        return

    # ── REVIEW ─────────────────────────────────────────────────────────────
    if status == PlanStatus.REVIEW:
        draft_plans: list[list[dict]] = state.get("draft_plans", [])

        if not draft_plans:
            # No drafts available – rebuild
            state["status"] = PlanStatus.BUILDING
            yield StepOutput(
                step_name="review",
                content="Let me rebuild the schedule for you.",
            )
            return

        response_text, new_status = _review_and_commit(user_message, draft_plans, state)
        state["status"] = new_status

        if new_status == PlanStatus.COMMITTED:
            # Emit client_action hints for reminders
            plan_blocks: list[dict] = state.get("plan", [])
            reminder_hints: list[dict] = []
            for block in plan_blocks:
                hint = {
                    "type": "client_action",
                    "tool": "reminders",
                    "method": "create_reminder",
                    "params": {
                        "title": block.get("title", ""),
                        "start_time": f"{planning_date}T{block.get('start', '09:00')}:00",
                        "notes": block.get("notes") or "",
                        "block_id": block.get("id", ""),
                    },
                }
                reminder_hints.append(hint)
            state["reminder_hints"] = reminder_hints

        yield StepOutput(step_name="review", content=response_text)
        return

    # ── COMMITTED (replanning request mid-day) ─────────────────────────────
    if status == PlanStatus.COMMITTED:
        completed_ids: list[str] = state.get("completed_block_ids", [])
        state["status"] = PlanStatus.REPLANNING
        # Update completed blocks from user message if mentioned
        state["user_replan_request"] = user_message
        response_text = (
            "Got it! I'll replan the rest of your day. "
            f"Completed blocks so far: {len(completed_ids)}. "
            "Rebuilding schedule..."
        )
        # Immediately fall through to building
        try:
            context = state.get("context", {})
            remaining_tasks = [
                t for t in tasks
                if t.get("id") not in completed_ids
            ]
            if not remaining_tasks:
                remaining_tasks = tasks
            build_text, draft_plans = _build_draft_plans_text(
                remaining_tasks, context, planning_date, timezone, user_message
            )
            state["draft_plans"] = draft_plans
            state["status"] = PlanStatus.REVIEW
            response_text = response_text + "\n\n" + build_text
        except Exception as exc:
            logger.error("[PlanningWorkflow] Replan failed: %s", exc)
            state["status"] = PlanStatus.REVIEW

        yield StepOutput(step_name="replan", content=response_text)
        return

    # ── FALLBACK ───────────────────────────────────────────────────────────
    yield StepOutput(
        step_name="fallback",
        content=(
            "I'm your day planner! Tell me about your tasks for the day "
            "and I'll help you build an optimised schedule."
        ),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Public factory
# ──────────────────────────────────────────────────────────────────────────────


def build_planning_workflow(
    session_id: str,
    session_state: dict | None = None,
    db: Any | None = None,
) -> Workflow:
    """Create and return a PlanningWorkflow instance.

    Args:
        session_id: Unique session ID (use chat_id for state persistence).
        session_state: Optional pre-loaded session state dict.
        db: Optional Agno DB for persistent session storage.

    Returns:
        Agno Workflow instance wired with the planning steps callable.
    """
    workflow = Workflow(
        name="DayPlannerWorkflow",
        description="Interactive day planner: gather context → build schedule → review → commit",
        steps=_planning_steps,  # type: ignore[arg-type]
        session_id=session_id,
        session_state=session_state or {},
        db=db,
        stream=True,
        stream_events=False,
        telemetry=False,
    )
    return workflow
