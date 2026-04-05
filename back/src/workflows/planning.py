"""Day Planner Workflow — multi-stage Agno Workflow implementation."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

from . import ors_client
from .models import StageResult
from .tools import search_place_hours, search_route_time_text, search_weather  # noqa: F401

logger = logging.getLogger(__name__)


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
        start = raw.find("{")
        if start == -1:
            raise ValueError("no JSON object found")
        data = json.loads(raw[start:])
        questions = data.get("pending_questions", [])
        return StageResult(
            output={"extracted_tasks": data.get("tasks", tasks)},
            pending_questions=questions,
            is_complete=len(questions) == 0,
        )
    except Exception:
        logger.warning("[PlanningWorkflow] EXTRACT: failed to parse LLM response, using raw tasks")
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
        start = raw.find("{")
        if start == -1:
            raise ValueError("no JSON object found")
        data = json.loads(raw[start:])
        return StageResult(
            output={"clusters": data.get("clusters", [])},
            pending_questions=data.get("pending_questions", []),
            is_complete=True,
        )
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.warning("[PlanningWorkflow] CLUSTER: failed to parse LLM response, using fallback")
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
                duration_min = ors_client.get_travel_time(src_coords, dst_coords, profile)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("[PlanningWorkflow] ROUTE: ORS failed for %s→%s: %s", src_loc, dst_loc, exc)
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

        travel_blocks.append({
            "from_location": src_loc,
            "to_location": dst_loc,
            "duration_min": duration_min,
            "mode": profile,
            "title": f"Выдвинуться в {dst_loc}",
            "insert_before_cluster_index": i + 1,
        })

    return StageResult(output={"travel_blocks": travel_blocks})
