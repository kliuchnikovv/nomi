"""Phase 1 coverage for slash commands: parser + /help + /status + unknown."""

from __future__ import annotations

import asyncio

import pytest

from src.server.models import Frame, Kind, Op
from src.server.slash_commands import SlashCommandContext, dispatch
from src.server.slash_commands.registry import parse


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("/help", ("help", "")),
        ("  /Status   ", ("status", "")),
        ("/forget мама", ("forget", "мама")),
        ("/think  high  ", ("think", "high")),
        ("/think low extra args", ("think", "low extra args")),
        ("not a command", None),
        ("", None),
        ("/", None),
        (" /1bad", None),  # name must start with letter or underscore
    ],
)
def test_parse(text, expected):
    assert parse(text) == expected


class _FakeFlags:
    def __init__(self, data: dict | None = None):
        self._data = data or {}

    async def get_flags(self, chat_id: str) -> dict:
        return dict(self._data)


def _make_ctx(
    *,
    payload: dict | None = None,
    flags: dict | None = None,
    storage_mode: str = "agno",
) -> tuple[SlashCommandContext, list[Frame]]:
    sent: list[Frame] = []
    next_id = {"n": 0}

    async def send_frame(frame: Frame):
        sent.append(frame)
        next_id["n"] += 1
        return next_id["n"]

    ctx = SlashCommandContext(
        user_id="user-1",
        chat_id="chat-1",
        session_id="sess-1",
        payload=payload or {},
        agent_storage_mode=storage_mode,
        send_frame=send_frame,
        next_id_fn=lambda: next_id["n"],
        redis_client=None,
        db_flags_module=_FakeFlags(flags),
    )
    return ctx, sent


@pytest.fixture
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.mark.asyncio
async def test_help_emits_text_and_done():
    ctx, sent = _make_ctx()
    handled = await dispatch("/help", ctx)
    assert handled is True
    # Expect MESSAGE + DONE
    assert [f.op for f in sent] == [Op.MESSAGE, Op.DONE]
    text = sent[0].payload["message"]
    assert "/help" in text
    assert "/status" in text


@pytest.mark.asyncio
async def test_status_includes_storage_mode_and_flags():
    ctx, sent = _make_ctx(
        payload={"model": "claude-opus-4-7", "agent_type": "nomi"},
        flags={"think_level": "high"},
        storage_mode="payload",
    )
    assert await dispatch("/status", ctx) is True
    body = sent[0].payload["message"]
    assert "claude-opus-4-7" in body
    assert "payload" in body
    assert "think_level" in body
    assert "high" in body


@pytest.mark.asyncio
async def test_status_no_flags():
    ctx, sent = _make_ctx(payload={"model": "x"}, flags={})
    await dispatch("/status", ctx)
    assert "(none)" in sent[0].payload["message"]


@pytest.mark.asyncio
async def test_unknown_command():
    ctx, sent = _make_ctx()
    assert await dispatch("/wat", ctx) is True
    body = sent[0].payload["message"]
    assert "Unknown command" in body
    assert "/wat" in body
    assert "/help" in body


@pytest.mark.asyncio
async def test_non_slash_returns_false():
    ctx, sent = _make_ctx()
    assert await dispatch("hello world", ctx) is False
    assert sent == []


@pytest.mark.asyncio
async def test_session_state_frame_is_meta():
    ctx, _ = _make_ctx()
    captured: list[Frame] = []

    async def capture(frame: Frame):
        captured.append(frame)

    ctx.send_frame = capture
    await ctx.send_session_state({"think_level": "low"})
    assert len(captured) == 1
    f = captured[0]
    assert f.kind == Kind.META
    assert f.op == Op.SESSION_STATE
    assert f.payload["flags"] == {"think_level": "low"}
    assert f.payload["storage_mode"] == "agno"
