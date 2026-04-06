import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from agno.agent import Agent
from agno.models.base import Model

logger = logging.getLogger(__name__)

PLANNER_INSTRUCTIONS = """You are a day planner assistant in ITERATE mode.
The user already has a structured plan with time, location, and note chips.
Your job is to apply precise edits to the existing plan — do NOT rebuild from scratch.

Available operations via patch_plan_document:
- Move a task: update its time chip
- Rename a task: update_item with new text
- Add/remove a task: add_item or remove_item
- Change location: update a location chip
- Add a note: add_chip with type=note

Rules:
- Always use exact item IDs from [Current plan:] block
- Use specific HH:MM-HH:MM time ranges, never vague terms like "morning"
- One patch_plan_document call per user request
- Respond in the user's language

If the user asks to replan the entire day or "start over", reply:
"Хочешь перестроить весь план с нуля? Напиши /replan чтобы начать заново."
Do NOT replan yourself — that is handled by the multi-stage workflow.
"""


def build_planner_agent(
    model: Model,
    tools: list,
    timezone: str | None = None,
    debug_mode: bool = False,
    db=None,
    session_id: str | None = None,
) -> Agent:
    """Build a lightweight planning agent."""
    tz = timezone or "UTC"
    now = datetime.now(ZoneInfo(tz)).strftime("%Y-%m-%d %H:%M %z")
    instructions = PLANNER_INSTRUCTIONS + f"\n\nCurrent date/time: {now}"

    return Agent(
        name="Planner",
        session_id=session_id,
        model=model,
        tools=tools,
        instructions=instructions,
        description="Day planning assistant that organizes tasks into a schedule.",
        add_history_to_context=True,
        add_datetime_to_context=False,
        markdown=True,
        stream=True,
        stream_events=True,
        debug_mode=debug_mode,
        telemetry=False,
        db=db,
    )
