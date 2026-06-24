"""Phase 2: /think handler — parse, persist, emit session_state."""

from __future__ import annotations

import asyncio

import pytest

from src.server.models import Frame, Kind, Op
from src.server.slash_commands import SlashCommandContext, dispatch


class _FakeFlags:
    def __init__(self, initial: dict | None = None):
        self.data: dict = dict(initial or {})

    async def get_flags(self, chat_id: str) -> dict:
        return dict(self.data)

    async def set_flag(self, chat_id: str, key: str, value) -> dict:
        self.data[key] = value
        return dict(self.data)


def _make_ctx(flags: _FakeFlags | None = None) -> tuple[SlashCommandContext, list[Frame], _FakeFlags]:
    sent: list[Frame] = []
    next_id = {"n": 0}

    async def send_frame(frame: Frame):
        sent.append(frame)
        next_id["n"] += 1
        return next_id["n"]

    f = flags or _FakeFlags()
    ctx = SlashCommandContext(
        user_id="user-1",
        chat_id="chat-1",
        session_id="sess-1",
        payload={},
        agent_storage_mode="agno",
        send_frame=send_frame,
        next_id_fn=lambda: next_id["n"],
        redis_client=None,
        db_flags_module=f,
    )
    return ctx, sent, f


@pytest.fixture
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("arg,expected", [
    ("low", "low"),
    ("Medium", "medium"),
    ("HIGH", "high"),
    ("off", "off"),
    ("med", "medium"),  # alias
    ("hi", "high"),     # alias
])
async def test_think_sets_level(arg, expected):
    ctx, sent, flags = _make_ctx()
    await dispatch(f"/think {arg}", ctx)
    assert flags.data["think_level"] == expected
    # session_state META + text MESSAGE + DONE
    ops = [(f.kind, f.op) for f in sent]
    assert (Kind.META, Op.SESSION_STATE) in ops
    assert ops[-1] == (Kind.META, Op.DONE)


@pytest.mark.asyncio
async def test_think_bad_arg_does_not_persist():
    ctx, sent, flags = _make_ctx()
    await dispatch("/think extreme", ctx)
    assert "think_level" not in flags.data
    assert "Unknown level" in sent[0].payload["message"]
    # No SESSION_STATE frame was emitted
    assert all(f.op != Op.SESSION_STATE for f in sent)


@pytest.mark.asyncio
async def test_think_no_arg_shows_current():
    ctx, sent, _ = _make_ctx(_FakeFlags({"think_level": "high"}))
    await dispatch("/think", ctx)
    body = sent[0].payload["message"]
    assert "Current think level" in body
    assert "high" in body


@pytest.mark.asyncio
async def test_think_off_message():
    ctx, sent, flags = _make_ctx()
    await dispatch("/think off", ctx)
    assert flags.data["think_level"] == "off"
    text_frames = [f for f in sent if f.op == Op.MESSAGE]
    assert "disabled" in text_frames[0].payload["message"].lower()


@pytest.mark.asyncio
async def test_help_lists_think():
    ctx, sent, _ = _make_ctx()
    await dispatch("/help", ctx)
    body = sent[0].payload["message"]
    assert "/think" in body
    assert "off|low|medium|high" in body
