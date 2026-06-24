"""Tests for agenda.today — server Google Calendar OR client iOS Calendar."""
from __future__ import annotations

import sys
from datetime import date

import pytest
from unittest.mock import MagicMock, AsyncMock

from src.commands.registry import CommandRegistry
from src.commands.context import CommandContext


def _reset_and_load():
    CommandRegistry._reset_for_tests()
    import src.commands as pkg
    pkg._loaded = False  # type: ignore[attr-defined]
    mod_name = "src.commands.agenda_today"
    if mod_name in sys.modules:
        del sys.modules[mod_name]
    from src.commands import load_commands
    load_commands()


@pytest.fixture(autouse=True)
def _isolate():
    _reset_and_load()
    yield
    CommandRegistry._reset_for_tests()


def _make_ctx():
    return CommandContext(
        user_id="user-1",
        session_id="sess-1",
        chat_id="chat-1",
        tools_config=None,
        knowledge=None,
        emit=AsyncMock(),
        client_tool_runner=None,
    )


def _server_event(summary, start_dt, location=None):
    return {"summary": summary, "start": {"dateTime": start_dt}, "location": location}


def test_agenda_is_registered_with_no_requires():
    spec = CommandRegistry.get("agenda.today")
    assert spec is not None
    assert spec.requires == ()


def test_agenda_defaults_to_today():
    spec = CommandRegistry.get("agenda.today")
    assert spec.args_model().day == date.today()


@pytest.mark.asyncio
async def test_agenda_via_server_calendar():
    spec = CommandRegistry.get("agenda.today")
    tk = MagicMock()
    tk.get_upcoming_events = AsyncMock(return_value=[
        _server_event("Standup", "2026-06-22T10:00:00+00:00"),
        _server_event("Tomorrow thing", "2026-06-23T09:00:00+00:00"),
        _server_event("Early call", "2026-06-22T08:30:00+00:00", location="Zoom"),
    ])
    ctx = _make_ctx()
    ctx.toolkit = AsyncMock(return_value=tk)

    result = await spec.handler(spec.args_model(day=date(2026, 6, 22)), ctx)

    assert result.ok is True
    titles = [e["title"] for e in result.data["events"]]
    assert titles == ["Early call", "Standup"]  # sorted by time, tomorrow excluded
    assert result.data["events"][0]["time"] == "08:30"
    assert "@ Zoom" in result.text


@pytest.mark.asyncio
async def test_agenda_via_device_ios_calendar():
    spec = CommandRegistry.get("agenda.today")
    # iOS Calendar executor wraps a JSON array in a ```json fenced <details> block.
    raw = (
        "<details><summary>Calendar Events</summary>\n\n```json\n"
        '[{"id":"1","title":"Gym","start":"2026-06-22T07:00:00+00:00",'
        '"end":"2026-06-22T08:00:00+00:00","allDay":false,"location":"Club"}]'
        "\n```\n</details>"
    )
    ctx = _make_ctx()
    ctx.toolkit = AsyncMock(return_value=None)  # no server calendar
    ctx.client_tool_runner = AsyncMock(return_value=raw)

    result = await spec.handler(spec.args_model(day=date(2026, 6, 22)), ctx)

    assert result.ok is True
    plugin, method, params = ctx.client_tool_runner.call_args.args
    assert plugin == "ios_calendar" and method == "get_events"
    assert params["start_date"] == "2026-06-22T00:00:00"
    assert result.data["events"] == [{"time": "07:00", "title": "Gym", "location": "Club"}]


@pytest.mark.asyncio
async def test_agenda_empty_day():
    spec = CommandRegistry.get("agenda.today")
    tk = MagicMock()
    tk.get_upcoming_events = AsyncMock(return_value=[])
    ctx = _make_ctx()
    ctx.toolkit = AsyncMock(return_value=tk)
    result = await spec.handler(spec.args_model(day=date(2026, 6, 22)), ctx)
    assert result.ok is True
    assert result.data["events"] == []
    assert "Nothing scheduled" in result.text


@pytest.mark.asyncio
async def test_agenda_no_calendar_integration():
    spec = CommandRegistry.get("agenda.today")
    ctx = _make_ctx()
    ctx.toolkit = AsyncMock(return_value=None)
    ctx.client_tool_runner = None
    result = await spec.handler(spec.args_model(), ctx)
    assert result.ok is False
    assert result.error["code"] == "calendar_not_connected"
