"""agenda.today command — one-tap agenda for a given day.

Works over either path, whichever the user has connected:
  - server-side Google Calendar (ctx.toolkit("calendar").get_upcoming_events)
    → list of event dicts (summary, start.dateTime/date, location)
  - client-only iOS Calendar (ctx.client_tool_runner("ios_calendar", "get_events", ...))
    → a string wrapping a JSON array of {title, start, end, allDay, location}

Both are normalized to {date, time, title, location}, filtered to the target
day, and formatted. Pure formatting — no model call. requires=() so the command
is always offered; availability is reported as a clear handler error.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date
from typing import Any

from pydantic import BaseModel, Field

from src.commands.base import CommandResult, command
from src.commands.context import CommandContext

logger = logging.getLogger(__name__)


class AgendaTodayArgs(BaseModel):
    day: date = Field(default_factory=date.today, description="Day to show (defaults to today)")


def _iso_time(iso: str) -> str:
    """"2026-06-22T09:30:00+03:00" -> "09:30"; date-only/empty -> "all-day"."""
    return iso[11:16] if len(iso) >= 16 and "T" in iso else "all-day"


def _norm_server(ev: dict[str, Any]) -> dict[str, Any]:
    start = (ev or {}).get("start") or {}
    dt = start.get("dateTime")
    if dt:
        return {"date": dt[:10], "time": _iso_time(dt),
                "title": ev.get("summary") or "(no title)", "location": ev.get("location")}
    return {"date": (start.get("date") or "")[:10], "time": "all-day",
            "title": ev.get("summary") or "(no title)", "location": ev.get("location")}


def _norm_device(ev: dict[str, Any]) -> dict[str, Any]:
    start = (ev or {}).get("start") or ""
    time = "all-day" if ev.get("allDay") else _iso_time(start)
    return {"date": start[:10], "time": time,
            "title": ev.get("title") or "(no title)", "location": ev.get("location")}


def _parse_device_events(raw: str) -> list[dict[str, Any]]:
    """Extract the JSON event array the iOS Calendar executor wraps in a
    ```json … ``` fenced block (inside a <details> element)."""
    if not raw:
        return []
    m = re.search(r"```json\s*(.*?)```", raw, re.DOTALL)
    candidate = m.group(1) if m else raw
    for blob in (candidate, raw):
        try:
            data = json.loads(blob)
            return data if isinstance(data, list) else []
        except Exception:
            arr = re.search(r"\[.*\]", blob, re.DOTALL)
            if arr:
                try:
                    data = json.loads(arr.group())
                    return data if isinstance(data, list) else []
                except Exception:
                    pass
    return []


async def _gather_events(target: str, ctx: CommandContext) -> list[dict[str, Any]] | None:
    """Normalized events for the target day, or None if no calendar is connected."""
    server_tk = await ctx.toolkit("calendar")
    if server_tk is not None:
        raw_events = await server_tk.get_upcoming_events(max_results=50)
        return [_norm_server(ev) for ev in (raw_events or [])]

    if ctx.client_tool_runner is not None:
        raw = await ctx.client_tool_runner(
            "ios_calendar", "get_events",
            {"start_date": f"{target}T00:00:00", "end_date": f"{target}T23:59:59", "limit": 50},
        )
        return [_norm_device(ev) for ev in _parse_device_events(raw)]

    return None


@command(
    name="agenda.today",
    title="Today's agenda",
    description="Show your calendar events for today (or a given day) at a glance.",
    args_model=AgendaTodayArgs,
    requires=(),
    surface="chat",
)
async def agenda_today(args: AgendaTodayArgs, ctx: CommandContext) -> CommandResult:
    target = args.day.isoformat()
    try:
        events = await _gather_events(target, ctx)
    except Exception:
        logger.exception("agenda.today fetch failed")
        return CommandResult.error(code="FETCH_FAILED", message="Failed to read your calendar.")

    if events is None:
        return CommandResult.error(
            code="calendar_not_connected",
            message="Connect a calendar to use /today.",
        )

    todays = sorted((e for e in events if e["date"] == target), key=lambda e: e["time"])
    if not todays:
        return CommandResult.ok(
            text=f"Nothing scheduled for {target}.",
            data={"date": target, "events": []},
        )

    lines = []
    out_events = []
    for e in todays:
        line = f"{e['time']}  {e['title']}"
        if e.get("location"):
            line += f"  @ {e['location']}"
        lines.append(line)
        out_events.append({"time": e["time"], "title": e["title"], "location": e.get("location")})

    return CommandResult.ok(
        text=f"Agenda for {target}:\n" + "\n".join(lines),
        data={"date": target, "events": out_events},
    )
