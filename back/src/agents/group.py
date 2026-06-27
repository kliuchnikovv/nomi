"""Lightweight agent for group / inline chat contexts.

Used for public conversations (Telegram group chats and inline queries) where the
assistant must answer directly from general knowledge and web search, WITHOUT any
access to the user's personal data (email, calendar, contacts, files) or personal
memory. It is intentionally stateless and minimal — mirrors the planner pattern.
"""

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from agno.agent import Agent
from agno.models.base import Model

logger = logging.getLogger(__name__)

GROUP_INSTRUCTIONS = """You are Nomi, a helpful AI assistant answering in a public group chat.

How to answer:
- Answer questions directly, factually, and concisely.
- You have a `web_search` tool. When a question needs current, factual, or niche
  information you are not sure about, use `web_search` immediately and answer from
  the results. Do NOT ask the user for permission to search — just do it.
- Cite sources when you rely on web search results.
- Respond in the user's language.

What you do NOT have here:
- You have NO access to the user's personal data — no email, calendar, contacts,
  files, tasks, or device. You also have no personal long-term memory.
- Never claim to have searched a "personal knowledge base" or the user's email.
- If asked about personal data, briefly explain you can't access it in a group chat.
"""


def build_group_agent(
    model: Model,
    tools: list,
    timezone: str | None = None,
    debug_mode: bool = False,
    db=None,
    session_id: str | None = None,
) -> Agent:
    """Build a lightweight, stateless group/inline chat agent (web search only)."""
    tz = timezone or "UTC"
    now = datetime.now(ZoneInfo(tz)).strftime("%Y-%m-%d %H:%M %z")
    instructions = GROUP_INSTRUCTIONS + f"\n\nCurrent date/time: {now}"

    return Agent(
        name="GroupChat",
        session_id=session_id,
        model=model,
        tools=tools,
        instructions=instructions,
        description="Direct-answer assistant for public group and inline chats.",
        add_history_to_context=True,
        add_datetime_to_context=False,
        markdown=True,
        stream=True,
        stream_events=True,
        debug_mode=debug_mode,
        telemetry=False,
        db=db,
    )
