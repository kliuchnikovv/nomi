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
from .tools import (  # noqa: F401
    search_place_hours,
    search_route_time_text,
    search_weather,
    search_transport_news,
    search_city_events,
)

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
- location: the primary place for this task — see location rules below
- destination_location: (transit/flight tasks only) the arrival airport or station — or null
- context_type: one of "home", "hotel", "place", "transit", "none"
- constraints: ordering requirements like "after breakfast" — or null

Location extraction rules:
- Regular tasks: use the place mentioned or implied (e.g. "gym", "office", "home").
- Transit/flight/train tasks: set context_type to "transit".
  - location: specific DEPARTURE point — use the full airport or station name
    (e.g. "Аэропорт Эль-Прат, Барселона" for a Barcelona departure).
  - destination_location: specific ARRIVAL point — use the full airport or station name
    (e.g. "Аэропорт Сабиха Гёкчен, Стамбул" for an Istanbul arrival).
  - Do NOT set location and destination_location to the same city.
  - Example: "Перелет Барселона → Стамбул" → location="Аэропорт Эль-Прат, Барселона",
    destination_location="Аэропорт Сабиха Гёкчен, Стамбул"

If the additional context contains a "clarification_qa" list of {"q": "...", "a": "..."} pairs,
use each answer to fill in the specific task field the question was about. Match the answer to
the task by reading the question carefully — do NOT reassign answers between tasks.
A time answer ("13:20 - 18:30") becomes time_hint ONLY for the task the question named explicitly.

If the additional context contains a "calendar_events" list, treat each event as an
additional task. Create a synthetic id by prepending "cal_" to the event's id field
(e.g. "cal_abc123"). Derive time_hint from start/end times in "HH:MM-HH:MM" format.
Set location from the event's "location" field if present, context_type to "place" if
a location is present else "none". Skip any calendar event whose title is substantially
identical (>80% word overlap) to an existing user task — do not create duplicates.

Also produce pending_questions: a list of questions to ask the user if duration,
location, or time is missing for important tasks. Keep each question concise and
specific to one task. Return an empty list if nothing is unclear.

Return ONLY valid JSON in this exact shape:
{
  "tasks": [
    {"id": "...", "time_hint": "14:00", "location": "office", "destination_location": null, "context_type": "place", "constraints": null},
    {"id": "...", "time_hint": "13:20-18:30", "location": "Аэропорт Эль-Прат, Барселона", "destination_location": "Аэропорт Сабиха Гёкчен, Стамбул", "context_type": "transit", "constraints": null}
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
        raw_questions = data.get("pending_questions", [])
        questions = [{"q": q, "opts": []} for q in raw_questions]
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


def _extract_city_hint(user_location: str | None, locations: dict) -> str | None:
    """Extract a usable city name for transport/news searches.

    Prefers user_location; falls back to the first geocoded non-origin location key.
    """
    if user_location:
        parts = [p.strip() for p in user_location.split(",")]
        return parts[-2] if len(parts) >= 2 else parts[0]
    for key in locations:
        if key != "__origin__" and locations[key].get("coords"):
            return key
    return None


def _run_recon_stage(
    extracted_tasks: list[dict],
    planning_date: str,
    transport_mode: str | None,
    user_location: str | None = None,
    planning_level: str = "standard",
) -> StageResult:
    locations: dict[str, dict] = {}

    # Geocode user's starting location as __origin__ for the ROUTE stage origin leg.
    if user_location:
        try:
            origin_coords = ors_client.geocode(user_location)
            locations["__origin__"] = {"coords": origin_coords, "hours": ""}
        except Exception:
            pass  # no origin — workflow continues without it

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

    # Transport and news context — only fetched for "full" level
    transport_news: str = ""
    if planning_level == "full":
        city = _extract_city_hint(user_location, locations)
        if city:
            parts = []
            for search_fn in [search_transport_news, search_city_events]:
                try:
                    result = search_fn(city, planning_date)[:300]
                    if result and not result.startswith("Search unavailable"):
                        parts.append(result)
                except Exception:
                    pass
            if parts:
                transport_news = "\n".join(parts)[:600]

    pending_questions: list[dict] = []
    if transport_mode is None:

        pending_questions.append({
            "q": "How do you plan to travel between locations?",
            "opts": ["Walking", "Driving", "Cycling", "Public transport"],
        })

    return StageResult(
        output={"locations": locations, "transport_mode": transport_mode, "transport_news": transport_news},
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
            pending_questions=[{"q": q, "opts": []} for q in data.get("pending_questions", [])],
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

    # Prepend origin → first cluster leg if user location was geocoded as __origin__.
    if "__origin__" in locations and clusters:
        first_loc = clusters[0].get("location", "")
        if first_loc and first_loc != "__origin__":
            origin_coords = locations["__origin__"].get("coords")
            first_coords = locations.get(first_loc, {}).get("coords")
            duration_min = 30
            if origin_coords and first_coords:
                try:
                    duration_min = ors_client.get_travel_time(origin_coords, first_coords, profile)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    pass
            travel_blocks.append({
                "from_location": "__origin__",
                "to_location": first_loc,
                "duration_min": duration_min,
                "mode": profile,
                "title": f"Head to {first_loc}",
                "insert_before_cluster_index": 0,
            })

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
                "title": f"Head to {dst_loc}",
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

IMPORTANT: If a task already has a time hint in its text (e.g., "Meeting at 14:00"),
KEEP that exact time. Only assign times to tasks that don't have explicit times.

TRANSIT/FLIGHT TASKS — CRITICAL:
- For tasks with context_type "transit": use the "location" field (departure airport) as the
  location chip value — NOT the generic city name.
- If the task has a "destination_location" field (non-null), add a note chip with value
  "→ <destination_location>" so the destination is visible.
- Do NOT add a location chip with a generic city name for transit tasks.

Apply patches in this STRICT order:
1. add_item — insert each travel task (one per travel block, place it before the destination cluster)
2. add_chip (type=time) — assign "HH:MM-HH:MM" time ranges to ALL tasks and travel tasks;
   for tasks with a non-null time_hint use that value exactly; for others infer from context
3. add_chip (type=location) — for transit tasks use the departure airport from the "location" field;
   for other tasks use their known location
4. add_chip (type=note) — value MUST be a JSON string with shape {"hours":"...","description":"...","info":"..."}.
   Use the location's "hours" field from context for opening hours.
   "description" — one-sentence summary of the place.
   "info" — useful tips: parking, payment methods, booking required, etc.
   Omit keys with no useful value. For transit tasks: {"info":"→ <destination_location>"}.
   Example value (escaped for JSON): "{\"hours\":\"09:00-22:00\",\"description\":\"Specialty coffee\",\"info\":\"Free WiFi, card only\"}"
5. update_item — strip embedded times/locations from task text if now captured in chips
6. reorder_items — include ALL item ids sorted by start time (MUST be the last patch)

For reorder_items, include ALL item IDs (original + newly added travel items).
Use specific time ranges only — never "morning" or "evening".

HEALTH RECOMMENDATIONS:
If health_summary contains sleep data where duration < 6.5 or quality == "poor":
- Add a new plan item at the end of the day: id="health_sleep_rec", text="Лечь спать до 22:00".
  Assign it a time chip "22:00-22:30".
- Add a note chip with value {"info": "10-мин перерыв — ночью было мало сна"} to the
  2-3 most time-intensive or cognitively heavy tasks in the plan.
- Only apply these rules if health_summary.sleep is present. Do not invent health data.

TRANSPORT DISRUPTIONS:
If transport_news is non-empty, check each travel block in the plan:
- If the disruption specifically mentions the city or transport mode used in that travel block,
  add a note chip to that travel block item with value {"info": "Проверь: <one-line summary>"}.
- Do not add generic notes to all tasks — only where specifically relevant.

Return ONLY valid JSON:
{
  "patches": [
    {"op": "add_item", "item": {"id": "...", "text": "Head to gym", "depth": 0, "checked": false, "chips": []}},
    {"op": "add_chip", "item_id": "...", "chip": {"type": "time", "value": "09:00-10:00", "id": "..."}},
    {"op": "add_chip", "item_id": "...", "chip": {"type": "location", "value": "Аэропорт Эль-Прат, Барселона", "id": "..."}},
    {"op": "add_chip", "item_id": "...", "chip": {"type": "note", "value": "{\"hours\":\"09:00-21:00\",\"description\":\"Specialty coffee bar\",\"info\":\"Card only, no reservations\"}", "id": "..."}},
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
    health_summary: dict | None = None,
    transport_news: str = "",
) -> StageResult:
    context = {
        "planning_date": planning_date,
        "timezone": timezone,
        "tasks": tasks,
        "clusters": clusters,
        "travel_blocks": travel_blocks,
        "locations": {k: {"hours": v.get("hours", "")} for k, v in locations.items()},
        "health_summary": health_summary or {},
        "transport_news": transport_news or "",
    }
    raw = _run_agent_text(_BUILD_PROMPT, json.dumps(context, ensure_ascii=False))
    try:
        data = _extract_json(raw)
        return StageResult(
            output={
                "patches": data.get("patches", []),
                "summary": data.get("summary", "Schedule built"),
            }
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("[PlanningWorkflow] BUILD parse failed: %s", exc)
        return StageResult(output={"patches": [], "summary": "Schedule built"})


# ──────────────────────────────────────────────────────────────────────────────
# Clarification helpers
# ──────────────────────────────────────────────────────────────────────────────

_STAGE_SEQUENCE = [
    PlanStatus.CONTEXT,
    PlanStatus.EXTRACT,
    PlanStatus.RECON,
    PlanStatus.CLUSTER,
    PlanStatus.ROUTE,
    PlanStatus.BUILD,
    PlanStatus.REVIEW,
]

_NEXT_STAGE = {a: b for a, b in zip(_STAGE_SEQUENCE, _STAGE_SEQUENCE[1:])}

STAGE_STATUS_TEXT: dict[str, str] = {
    PlanStatus.CONTEXT: "Loading your context...",
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
    # Record Q&A pair: the question that was last shown to the user
    current_q = state.pop("_current_clarifying_question", None)
    state.pop("_current_clarifying_options", None)
    state.setdefault("clarification_answers", [])
    state["clarification_answers"].append(user_message)
    state.setdefault("clarification_qa", [])
    if current_q:
        state["clarification_qa"].append({"q": current_q, "a": user_message})

    questions: list[dict] = state.get("pending_questions", [])
    if questions:
        item = questions.pop(0)
        state["pending_questions"] = questions
        state["_current_clarifying_question"] = item["q"]
        state["_current_clarifying_options"] = item.get("opts", [])
        return item["q"], False

    # All questions answered — return to pending stage
    pending = state.get("pending_stage", PlanStatus.EXTRACT)
    state["status"] = pending
    state[f"{pending}_clarified"] = True
    return None, True


def _infer_transport(user_message: str, clarification_answers: list[str]) -> str | None:
    """Infer transport mode from user message or clarification answers. Returns None if unclear."""
    all_text = " ".join([user_message] + clarification_answers).lower()
    if any(w in all_text for w in ("car", "drive", "авто", "машин", "автомобил")):
        return "car"
    if any(w in all_text for w in ("bike", "cycling", "велосипед", "вело")):
        return "cycling"
    if any(w in all_text for w in ("walk", "пешком", "пеш", "пешеход")):
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
    status: str = state.get("status", PlanStatus.CONTEXT)

    logger.info("[PlanningWorkflow] status=%s tasks=%d", status, len(tasks))

    # CONTEXT stage: context_data is populated by redis_session before the workflow.
    # Just advance the status so subsequent stages can read it.
    if state.get("status") in (PlanStatus.CONTEXT, None) and "context_data" in state:
        state["status"] = PlanStatus.EXTRACT
        logger.info("[PlanningWorkflow] CONTEXT done, advancing to EXTRACT")

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

            yield StepOutput(step_name="continue", content="OK, continuing...\n")

        status = state.get("status", PlanStatus.EXTRACT)

    # ── EXTRACT ───────────────────────────────────────────────────────────────
    if state.get("status", PlanStatus.EXTRACT) == PlanStatus.EXTRACT:
        logger.info("[PlanningWorkflow] Running EXTRACT stage")
        result = _run_extract_stage(
            tasks,
            {
                "clarifications": state.get("clarification_answers", []),
                "clarification_qa": state.get("clarification_qa", []),
            },
        )
        if result.pending_questions and not state.get("extract_clarified"):
            first_item = result.pending_questions[0]
            state["pending_questions"] = result.pending_questions[1:]
            state["pending_stage"] = PlanStatus.EXTRACT
            state["status"] = PlanStatus.CLARIFYING
            state["_current_clarifying_question"] = first_item["q"]
            state["_current_clarifying_options"] = first_item.get("opts", [])
            yield StepOutput(step_name="clarify", content=first_item["q"])
            return
        state["extract_output"] = result.output
        state["status"] = PlanStatus.RECON
        logger.info("[PlanningWorkflow] EXTRACT done, moving to RECON")

        yield StepOutput(step_name="extract", content="Analyzing tasks...\n")


    # ── RECON ─────────────────────────────────────────────────────────────────
    if state.get("status") == PlanStatus.RECON:
        logger.info("[PlanningWorkflow] Running RECON stage")
        extracted = state.get("extract_output", {}).get("extracted_tasks", tasks)
        transport = state.get("recon_output", {}).get(
            "transport_mode"
        ) or _infer_transport(user_message, state.get("clarification_answers", []))
        user_location = state.get("user_location")
        result = _run_recon_stage(
            extracted, planning_date, transport,
            user_location=user_location,
            planning_level=state.get("planning_level", "standard"),
        )
        if result.pending_questions and not state.get("recon_clarified"):
            first_item = result.pending_questions[0]
            state["pending_questions"] = result.pending_questions[1:]
            state["pending_stage"] = PlanStatus.RECON
            state["status"] = PlanStatus.CLARIFYING
            state["_current_clarifying_question"] = first_item["q"]
            state["_current_clarifying_options"] = first_item.get("opts", [])
            yield StepOutput(step_name="clarify", content=first_item["q"])
            return
        state["recon_output"] = result.output
        state["status"] = PlanStatus.CLUSTER

        yield StepOutput(step_name="recon", content="Looking up locations...\n")


    # ── CLUSTER ───────────────────────────────────────────────────────────────
    if state.get("status") == PlanStatus.CLUSTER:
        logger.info("[PlanningWorkflow] Running CLUSTER stage")
        extracted = state.get("extract_output", {}).get("extracted_tasks", tasks)
        locations = state.get("recon_output", {}).get("locations", {})
        result = _run_cluster_stage(extracted, locations)
        if result.pending_questions and not state.get("cluster_clarified"):
            first_item = result.pending_questions[0]
            state["pending_questions"] = result.pending_questions[1:]
            state["pending_stage"] = PlanStatus.CLUSTER
            state["status"] = PlanStatus.CLARIFYING
            state["_current_clarifying_question"] = first_item["q"]
            state["_current_clarifying_options"] = first_item.get("opts", [])
            yield StepOutput(step_name="clarify", content=first_item["q"])
            return
        state["cluster_output"] = result.output
        state["status"] = PlanStatus.ROUTE
        logger.info("[PlanningWorkflow] CLUSTER done, moving to ROUTE")

        yield StepOutput(step_name="cluster", content="Grouping tasks by location...\n")


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

        yield StepOutput(step_name="route", content="Calculating route...\n")


    # ── BUILD ─────────────────────────────────────────────────────────────────
    if state.get("status") == PlanStatus.BUILD:
        logger.info("[PlanningWorkflow] Running BUILD stage")
        extracted = state.get("extract_output", {}).get("extracted_tasks", tasks)
        clusters = state.get("cluster_output", {}).get("clusters", [])
        travel_blocks = state.get("route_output", {}).get("travel_blocks", [])
        locations = state.get("recon_output", {}).get("locations", {})
        result = _run_build_stage(
            extracted, clusters, travel_blocks, locations, planning_date, timezone,
            health_summary=state.get("context_data", {}).get("health_summary", {}),
            transport_news=state.get("recon_output", {}).get("transport_news", ""),
        )
        state["plan_patches"] = {
            "patches": result.output.get("patches", []),
            "summary": result.output.get("summary", "Schedule is ready"),
        }
        state["status"] = PlanStatus.REVIEW
        yield StepOutput(
            step_name="build", content="Schedule is built! Check your plan.\n"
        )
        return

    # ── REVIEW ────────────────────────────────────────────────────────────────
    if state.get("status") == PlanStatus.REVIEW:
        state["status"] = PlanStatus.ITERATE
        yield StepOutput(
            step_name="review",
            content="Done! You can ask me to change any task, reschedule, or add a new one.\n",
        )
        return

    # ── ITERATE / FALLBACK ────────────────────────────────────────────────────
    yield StepOutput(
        step_name="iterate",
        content="How can I help with your plan? You can ask me to move a task, change the time, or redo the entire plan.\n",
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
