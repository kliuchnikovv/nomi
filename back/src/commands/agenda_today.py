"""agenda.today command — one-tap agenda for a given day.

Pulls upcoming events from the connected (server-side) Google Calendar and
filters them to the target date. Pure formatting — no model call — so it's fast
and cheap. Degrades to a clear message if the calendar isn't connected.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any

from pydantic import BaseModel, Field

from src.commands.base import CommandResult, command
from src.commands.context import CommandContext

logger = logging.getLogger(__name__)


class AgendaTodayArgs(BaseModel):
    day: date = Field(default_factory=date.today, description="Day to show (defaults to today)")


def _event_date(ev: dict[str, Any]) -> str:
    """ISO date (YYYY-MM-DD) of an event's start, from dateTime or all-day date."""
    start = (ev or {}).get("start") or {}
    raw = start.get("dateTime") or start.get("date") or ""
    return raw[:10]


def _event_time(ev: dict[str, Any]) -> str:
    start = (ev or {}).get("start") or {}
    dt = start.get("dateTime")
    if not dt:
        return "all-day"
    # "2026-06-22T09:30:00+03:00" -> "09:30"
    return dt[11:16] if len(dt) >= 16 else dt


@command(
    name="agenda.today",
    title="Today's agenda",
    description="Show your calendar events for today (or a given day) at a glance.",
    args_model=AgendaTodayArgs,
    requires=("calendar",),
    surface="chat",
)
async def agenda_today(args: AgendaTodayArgs, ctx: CommandContext) -> CommandResult:
    tk = await ctx.toolkit("calendar")
    if tk is None:
        return CommandResult.error(
            code="calendar_not_connected",
            message="Connect a calendar to use /today.",
        )

    target = args.day.isoformat()
    try:
        events = await tk.get_upcoming_events(max_results=50)
    except Exception:
        logger.exception("agenda.today fetch failed")
        return CommandResult.error(
            code="FETCH_FAILED",
            message="Failed to read your calendar.",
        )

    todays = [ev for ev in (events or []) if _event_date(ev) == target]
    todays.sort(key=_event_time)

    if not todays:
        return CommandResult.ok(
            text=f"Nothing scheduled for {target}.",
            data={"date": target, "events": []},
        )

    lines = []
    out_events = []
    for ev in todays:
        when = _event_time(ev)
        title = ev.get("summary") or "(no title)"
        location = ev.get("location")
        line = f"{when}  {title}"
        if location:
            line += f"  @ {location}"
        lines.append(line)
        out_events.append({"time": when, "title": title, "location": location})

    return CommandResult.ok(
        text=f"Agenda for {target}:\n" + "\n".join(lines),
        data={"date": target, "events": out_events},
    )
