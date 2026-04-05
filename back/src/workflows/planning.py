"""Day Planner Workflow — multi-stage Agno Workflow implementation."""

from __future__ import annotations

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
        end = raw.rfind("}") + 1
        data = json.loads(raw[start:end])
        questions = data.get("pending_questions", [])
        return StageResult(
            output={"extracted_tasks": data.get("tasks", tasks)},
            pending_questions=questions,
            is_complete=len(questions) == 0,
        )
    except Exception:
        return StageResult(output={"extracted_tasks": tasks})


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

        coords = ors_client.geocode(loc)
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
