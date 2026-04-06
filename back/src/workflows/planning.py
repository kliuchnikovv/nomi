"""Day Planner Workflow — multi-stage Agno Workflow implementation."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Iterator

from agno.workflow import Workflow
from agno.workflow.types import WorkflowExecutionInput, StepOutput

from . import ors_client
from .models import PlanStatus, PlanningInput, StageResult
from .tools import search_place_hours, search_route_time_text, search_weather  # noqa: F401

logger = logging.getLogger(__name__)


def _extract_json(text: str) -> dict:
    """Extract and parse JSON from LLM response that may contain multiple JSON objects."""
    start = text.find("{")
    if start == -1:
        raise ValueError("no JSON object found")

    # Find matching closing brace - handle nested objects
    depth = 0
    end = start
    for i, c in enumerate(text[start:], start):
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break

    json_str = text[start:end]
    return json.loads(json_str)


# ──────────────────────────────────────────────────────────────────────────────
# LLM helper
# ──────────────────────────────────────────────────────────────────────────────


def _build_model() -> Any:
    from src.models.safe_gemini import SafeGemini

    return SafeGemini(id="gemini-2.0-flash", api_key=os.getenv("GOOGLE_API_KEY", ""))


def _run_agent_text(system_prompt: str, user_prompt: str) -> str:
    try:
        from agno.agent import Agent

        agent = Agent(
            model=_build_model(),
            instructions=system_prompt,
            stream=False,
            telemetry=False,
        )
        result = agent.run(user_prompt, stream=False)
        return str(getattr(result, "content", "") or "")
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("[PlanningWorkflow] LLM call failed: %s", exc)
        return ""


# ──────────────────────────────────────────────────────────────────────────────
# EXTRACT stage
# ──────────────────────────────────────────────────────────────────────────────

_EXTRACT_PROMPT = """You are analyzing a task list for day planning.
For each task extract:
- id: the task id (unchanged)
- time_hint: explicit time already in the title (e.g. "14:00", "evening") — or null
- location: place mentioned or implied (e.g. "gym", "office", "home") — or null
- context_type: one of "home", "hotel", "place", "transit", "none"
- constraints: ordering requirements like "after breakfast" — or null

Also produce pending_questions: a list of questions to ask the user if duration,
location, or time is missing for important tasks. Keep each question concise and
specific to one task. Return an empty list if nothing is unclear.

Return ONLY valid JSON in this exact shape:
{
  "tasks": [
    {"id": "...", "time_hint": "14:00", "location": "office", "context_type": "place", "constraints": null}
  ],
  "pending_questions": ["What time is your gym session?"]
}"""


def _run_extract_stage(tasks: list[dict], context: dict) -> StageResult:
    tasks_json = json.dumps(tasks, ensure_ascii=False)
    raw = _run_agent_text(
        _EXTRACT_PROMPT,
        f"Tasks: {tasks_json}\nAdditional context: {json.dumps(context, ensure_ascii=False)}",
    )
    try:
        data = _extract_json(raw)
        questions = data.get("pending_questions", [])
        return StageResult(
            output={"extracted_tasks": data.get("tasks", tasks)},
            pending_questions=questions,
            is_complete=len(questions) == 0,
        )
    except Exception:
        logger.warning(
            "[PlanningWorkflow] EXTRACT: failed to parse LLM response, using raw tasks"
        )
        return StageResult(output={"extracted_tasks": tasks}, is_complete=False)


# ──────────────────────────────────────────────────────────────────────────────
# RECON stage
# ──────────────────────────────────────────────────────────────────────────────

_SKIP_CONTEXT_TYPES = {"home", "hotel", "none"}


def _run_recon_stage(
    extracted_tasks: list[dict],
    planning_date: str,
    transport_mode: str | None,
) -> StageResult:
    locations: dict[str, dict] = {}

    for task in extracted_tasks:
        loc = task.get("location")
        ctx = task.get("context_type", "none")
        if not loc or ctx in _SKIP_CONTEXT_TYPES or loc in locations:
            continue

        try:
            coords = ors_client.geocode(loc)
        except Exception:
            coords = None
        hours = ""
        try:
            hours = search_place_hours(loc, planning_date)[:300]
        except Exception:
            pass

        locations[loc] = {"coords": coords, "hours": hours}

    pending_questions: list[str] = []
    if transport_mode is None:
        pending_questions.append(
            "На чём планируешь передвигаться между точками? (пешком / на машине / на велосипеде)"
        )

    return StageResult(
        output={"locations": locations, "transport_mode": transport_mode},
        pending_questions=pending_questions,
        is_complete=transport_mode is not None,
    )


# ──────────────────────────────────────────────────────────────────────────────
# CLUSTER stage
# ──────────────────────────────────────────────────────────────────────────────

_CLUSTER_PROMPT = """You are grouping tasks into location clusters for efficient day planning.

Rules:
- Group tasks at the same or nearby location into one cluster
- Tasks with context_type "home" or "hotel" are PREFERRED at start/end of day,
  but can appear mid-day if explicitly planned (e.g. "return home for lunch",
  "pick up documents at hotel")
- Never merge tasks with incompatible contexts (e.g. wake-up and sleep cannot be combined)
- Tasks without a location attach to the nearest cluster by time
- Order clusters to minimize total travel distance

Return ONLY valid JSON:
{
  "clusters": [
    {"location": "home", "context_type": "home", "task_ids": ["t1", "t2"]},
    {"location": "gym", "context_type": "place", "task_ids": ["t3"]}
  ],
  "pending_questions": []
}"""


def _run_cluster_stage(
    extracted_tasks: list[dict],
    locations: dict,
) -> StageResult:
    prompt_input = json.dumps(
        {"tasks": extracted_tasks, "locations": locations},
        ensure_ascii=False,
    )
    raw = _run_agent_text(_CLUSTER_PROMPT, prompt_input)
    try:
        data = _extract_json(raw)
        return StageResult(
            output={"clusters": data.get("clusters", [])},
            pending_questions=data.get("pending_questions", []),
            is_complete=True,
        )
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.warning(
            "[PlanningWorkflow] CLUSTER: failed to parse LLM response, using fallback"
        )
        # Fallback: one cluster per task
        clusters = [
            {
                "location": t.get("location", ""),
                "context_type": t.get("context_type", "none"),
                "task_ids": [t["id"]],
            }
            for t in extracted_tasks
        ]
        return StageResult(output={"clusters": clusters}, is_complete=True)


# ──────────────────────────────────────────────────────────────────────────────
# ROUTE stage
# ──────────────────────────────────────────────────────────────────────────────

_PROFILE_MAP = {
    "walking": "foot-walking",
    "car": "driving-car",
    "cycling": "cycling-regular",
}


def _run_route_stage(
    clusters: list[dict],
    locations: dict,
    transport_mode: str,
) -> StageResult:
    profile = _PROFILE_MAP.get(transport_mode, "foot-walking")
    travel_blocks: list[dict] = []

    for i in range(len(clusters) - 1):
        src_loc = clusters[i].get("location", "")
        dst_loc = clusters[i + 1].get("location", "")

        if not src_loc or not dst_loc or src_loc == dst_loc:
            continue

        src_coords = locations.get(src_loc, {}).get("coords")
        dst_coords = locations.get(dst_loc, {}).get("coords")
        duration_min = 30  # default fallback

        if src_coords and dst_coords:
            try:
                duration_min = ors_client.get_travel_time(
                    src_coords, dst_coords, profile
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning(
                    "[PlanningWorkflow] ROUTE: ORS failed for %s→%s: %s",
                    src_loc,
                    dst_loc,
                    exc,
                )
        else:
            try:
                ddg_result = search_route_time_text(src_loc, dst_loc)
                parsed = _run_agent_text(
                    "Extract travel time in minutes from the text. Return only an integer number, nothing else.",
                    ddg_result[:300],
                )
                parsed = parsed.strip()
                if parsed.isdigit():
                    duration_min = int(parsed)
            except asyncio.CancelledError:
                raise
            except Exception:
                pass

        travel_blocks.append(
            {
                "from_location": src_loc,
                "to_location": dst_loc,
                "duration_min": duration_min,
                "mode": profile,
                "title": f"Выдвинуться в {dst_loc}",
                "insert_before_cluster_index": i + 1,
            }
        )

    return StageResult(output={"travel_blocks": travel_blocks})


# ──────────────────────────────────────────────────────────────────────────────
# BUILD stage
# ──────────────────────────────────────────────────────────────────────────────

_BUILD_PROMPT = """You are building the final day schedule by applying structured patches.

Given clusters, travel blocks, task metadata, and planning date, produce a patch list
that transforms the raw task list into a fully scheduled day.

Apply patches in this STRICT order:
1. add_item — insert each travel task (one per travel block, place it before the destination cluster)
2. add_chip (type=time) — assign "HH:MM-HH:MM" time ranges to ALL tasks and travel tasks
3. add_chip (type=location) — add location chips to tasks that have a known location
4. add_chip (type=note) — add note chips with useful comments (travel time, opening hours)
5. update_item — strip embedded times/locations from task text if they are now captured in chips
6. reorder_items — include ALL item ids sorted by start time (this MUST be the last patch)

For reorder_items, include ALL item IDs (original + newly added travel items).
Use specific time ranges only — never "morning" or "evening".

Return ONLY valid JSON:
{
  "patches": [
    {"op": "add_item", "item": {"id": "...", "text": "Выдвинуться в gym", "depth": 0, "checked": false, "chips": []}},
    {"op": "add_chip", "item_id": "...", "chip": {"type": "time", "value": "09:00-10:00", "id": "..."}},
    {"op": "reorder_items", "ids": ["id1", "id2", "id3"]}
  ],
  "summary": "Added times and travel tasks"
}"""


def _run_build_stage(
    tasks: list[dict],
    clusters: list[dict],
    travel_blocks: list[dict],
    locations: dict,
    planning_date: str,
    timezone: str,
) -> StageResult:
    context = {
        "planning_date": planning_date,
        "timezone": timezone,
        "tasks": tasks,
        "clusters": clusters,
        "travel_blocks": travel_blocks,
        "locations": {k: {"hours": v.get("hours", "")} for k, v in locations.items()},
    }
    raw = _run_agent_text(_BUILD_PROMPT, json.dumps(context, ensure_ascii=False))
    try:
        data = _extract_json(raw)
        return StageResult(
            output={
                "patches": data.get("patches", []),
                "summary": data.get("summary", "Расписание построено"),
            }
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("[PlanningWorkflow] BUILD parse failed: %s", exc)
        return StageResult(output={"patches": [], "summary": "Расписание построено"})


# ──────────────────────────────────────────────────────────────────────────────
# Clarification helpers
# ──────────────────────────────────────────────────────────────────────────────

_STAGE_SEQUENCE = [
    PlanStatus.EXTRACT,
    PlanStatus.RECON,
    PlanStatus.CLUSTER,
    PlanStatus.ROUTE,
    PlanStatus.BUILD,
    PlanStatus.REVIEW,
]

_NEXT_STAGE = {a: b for a, b in zip(_STAGE_SEQUENCE, _STAGE_SEQUENCE[1:])}

STAGE_STATUS_TEXT: dict[str, str] = {
    PlanStatus.EXTRACT: "Analyzing tasks...",
    PlanStatus.RECON: "Looking up locations...",
    PlanStatus.CLUSTER: "Grouping by area...",
    PlanStatus.ROUTE: "Calculating routes...",
    PlanStatus.BUILD: "Building schedule...",
    PlanStatus.REVIEW: "Building schedule...",
    PlanStatus.ITERATE: "Updating plan...",
    PlanStatus.CLARIFYING: "Clarifying details...",
}


def _handle_clarifying(
    state: dict,
    user_message: str,
) -> tuple[str | None, bool]:
    """Process a user reply during the clarification phase.

    Returns (next_question_or_none, should_return_to_stage).
    """
    state.setdefault("clarification_answers", [])
    state["clarification_answers"].append(user_message)

    questions: list[str] = state.get("pending_questions", [])
    if questions:
        next_q = questions.pop(0)
        state["pending_questions"] = questions
        return next_q, False

    # All questions answered — return to pending stage
    pending = state.get("pending_stage", PlanStatus.EXTRACT)
    state["status"] = pending
    state[f"{pending}_clarified"] = True
    return None, True


def _infer_transport(user_message: str, clarification_answers: list[str]) -> str | None:
    """Infer transport mode from user message or clarification answers. Returns None if unclear."""
    all_text = " ".join([user_message] + clarification_answers).lower()
    if any(w in all_text for w in ("машин", "авто", "автомобил", "car", "drive")):
        return "car"
    if any(w in all_text for w in ("велосипед", "вело", "bike", "cycling")):
        return "cycling"
    if any(w in all_text for w in ("пешком", "пеш", "walk", "пешеход")):
        return "walking"
    return None


# ──────────────────────────────────────────────────────────────────────────────
# Main workflow steps callable
# ──────────────────────────────────────────────────────────────────────────────


def _planning_steps(
    workflow: Workflow,
    execution_input: WorkflowExecutionInput,
    **kwargs: Any,
) -> Iterator[StepOutput]:
    if workflow.session_state is None:
        workflow.session_state = {}
    state: dict = workflow.session_state

    # Parse input
    user_message: str = ""
    if execution_input.input:
        user_message = str(execution_input.input)

    planning_input: PlanningInput | None = None
    if (
        execution_input.additional_data
        and "planning_input" in execution_input.additional_data
    ):
        raw = execution_input.additional_data["planning_input"]
        planning_input = raw if isinstance(raw, PlanningInput) else PlanningInput(**raw)

    if planning_input:
        if planning_input.tasks:
            state["tasks"] = [t.model_dump() for t in planning_input.tasks]
        state.setdefault("planning_date", planning_input.planning_date)
        state.setdefault("timezone", planning_input.timezone)

    tasks: list[dict] = state.get("tasks", [])
    planning_date: str = state.get("planning_date", "")
    timezone: str = state.get("timezone", "UTC")
    status: str = state.get("status", PlanStatus.EXTRACT)

    logger.info("[PlanningWorkflow] status=%s tasks=%d", status, len(tasks))

    # ── CLARIFYING ────────────────────────────────────────────────────────────
    if status == PlanStatus.CLARIFYING:
        next_q, back_to_stage = _handle_clarifying(state, user_message)
        if not back_to_stage and next_q:
            yield StepOutput(step_name="clarify", content=next_q)
            return
        # Returned to a stage - continue workflow
        if back_to_stage:
            pending = state.get("pending_stage", PlanStatus.EXTRACT)
            logger.info(
                "[PlanningWorkflow] Returning from clarification to %s", pending
            )
            yield StepOutput(step_name="continue", content="Хорошо, продолжаю...")
        status = state.get("status", PlanStatus.EXTRACT)

    # ── EXTRACT ───────────────────────────────────────────────────────────────
    if state.get("status", PlanStatus.EXTRACT) == PlanStatus.EXTRACT:
        logger.info("[PlanningWorkflow] Running EXTRACT stage")
        result = _run_extract_stage(
            tasks, {"clarifications": state.get("clarification_answers", [])}
        )
        if result.pending_questions and not state.get("extract_clarified"):
            state["pending_questions"] = result.pending_questions[1:]
            state["pending_stage"] = PlanStatus.EXTRACT
            state["status"] = PlanStatus.CLARIFYING
            yield StepOutput(step_name="clarify", content=result.pending_questions[0])
            return
        state["extract_output"] = result.output
        state["status"] = PlanStatus.RECON
        logger.info("[PlanningWorkflow] EXTRACT done, moving to RECON")
        return

    # ── RECON ─────────────────────────────────────────────────────────────────
    if state.get("status") == PlanStatus.RECON:
        logger.info("[PlanningWorkflow] Running RECON stage")
        extracted = state.get("extract_output", {}).get("extracted_tasks", tasks)
        transport = state.get("recon_output", {}).get(
            "transport_mode"
        ) or _infer_transport(user_message, state.get("clarification_answers", []))
        result = _run_recon_stage(extracted, planning_date, transport)
        if result.pending_questions and not state.get("recon_clarified"):
            state["pending_questions"] = result.pending_questions[1:]
            state["pending_stage"] = PlanStatus.RECON
            state["status"] = PlanStatus.CLARIFYING
            yield StepOutput(step_name="clarify", content=result.pending_questions[0])
            return
        state["recon_output"] = result.output
        state["status"] = PlanStatus.CLUSTER
        return

    # ── CLUSTER ───────────────────────────────────────────────────────────────
    if state.get("status") == PlanStatus.CLUSTER:
        logger.info("[PlanningWorkflow] Running CLUSTER stage")
        extracted = state.get("extract_output", {}).get("extracted_tasks", tasks)
        locations = state.get("recon_output", {}).get("locations", {})
        result = _run_cluster_stage(extracted, locations)
        if result.pending_questions and not state.get("cluster_clarified"):
            state["pending_questions"] = result.pending_questions[1:]
            state["pending_stage"] = PlanStatus.CLUSTER
            state["status"] = PlanStatus.CLARIFYING
            yield StepOutput(step_name="clarify", content=result.pending_questions[0])
            return
        state["cluster_output"] = result.output
        state["status"] = PlanStatus.ROUTE
        logger.info("[PlanningWorkflow] CLUSTER done, moving to ROUTE")
        return

    # ── ROUTE ─────────────────────────────────────────────────────────────────
    if state.get("status") == PlanStatus.ROUTE:
        logger.info("[PlanningWorkflow] Running ROUTE stage")
        clusters = state.get("cluster_output", {}).get("clusters", [])
        locations = state.get("recon_output", {}).get("locations", {})
        transport = state.get("recon_output", {}).get("transport_mode", "walking")
        result = _run_route_stage(clusters, locations, transport)
        state["route_output"] = result.output
        state["status"] = PlanStatus.BUILD
        logger.info("[PlanningWorkflow] ROUTE done, moving to BUILD")
        return

    # ── BUILD ─────────────────────────────────────────────────────────────────
    if state.get("status") == PlanStatus.BUILD:
        logger.info("[PlanningWorkflow] Running BUILD stage")
        extracted = state.get("extract_output", {}).get("extracted_tasks", tasks)
        clusters = state.get("cluster_output", {}).get("clusters", [])
        travel_blocks = state.get("route_output", {}).get("travel_blocks", [])
        locations = state.get("recon_output", {}).get("locations", {})
        result = _run_build_stage(
            extracted, clusters, travel_blocks, locations, planning_date, timezone
        )
        state["plan_patches"] = {
            "patches": result.output.get("patches", []),
            "summary": result.output.get("summary", "Расписание готово"),
        }
        state["status"] = PlanStatus.REVIEW
        yield StepOutput(
            step_name="build", content="Расписание построено! Проверь план."
        )
        return

    # ── REVIEW ────────────────────────────────────────────────────────────────
    if state.get("status") == PlanStatus.REVIEW:
        state["status"] = PlanStatus.ITERATE
        yield StepOutput(
            step_name="review",
            content="Готово! Можешь попросить изменить любую задачу, переставить время или добавить новую.",
        )
        return

    # ── ITERATE / FALLBACK ────────────────────────────────────────────────────
    yield StepOutput(
        step_name="iterate",
        content="Чем могу помочь с планом? Можешь попросить перенести задачу, изменить время или переделать весь план.",
    )


# ──────────────────────────────────────────────────────────────────────────────
# Public factory
# ──────────────────────────────────────────────────────────────────────────────


def build_planning_workflow(
    session_id: str,
    session_state: dict | None = None,
    db: Any | None = None,
) -> Workflow:
    """Create and return the day planner Agno Workflow."""
    return Workflow(
        name="DayPlannerWorkflow",
        description="Multi-stage day planner: extract → recon → cluster → route → build → review",
        steps=_planning_steps,  # type: ignore[arg-type]
        session_id=session_id,
        session_state=session_state or {},
        db=db,
        stream=True,
        stream_events=False,
        telemetry=False,
    )
