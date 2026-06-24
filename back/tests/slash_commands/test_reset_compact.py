"""Phase 4: /reset (two-step) + /compact + pending state."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from src.server.models import Frame, Kind, Op
from src.server.slash_commands import SlashCommandContext, dispatch


class _FakeRedis:
    def __init__(self):
        self.store: dict = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def set(self, key: str, value, ex=None, nx=None):
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True

    async def delete(self, key: str):
        self.store.pop(key, None)


class _FakeFlags:
    def __init__(self, initial: dict | None = None):
        self.data: dict = dict(initial or {})

    async def get_flags(self, chat_id: str) -> dict:
        return dict(self.data)

    async def set_flag(self, chat_id: str, key: str, value) -> dict:
        self.data[key] = value
        return dict(self.data)

    async def clear_flags(self, chat_id: str) -> None:
        self.data.clear()


class _FakeAgnoDB:
    def __init__(self, session=None):
        self._session = session
        self.deleted_session_id: str | None = None

    def get_session(self, session_id, session_type, deserialize=True):
        return self._session

    def delete_session(self, session_id):
        self.deleted_session_id = session_id
        return True


def _ctx(
    *,
    redis_client=None,
    flags=None,
    agno_db=None,
    build_model=None,
    user_id="user-1",
) -> tuple[SlashCommandContext, list[Frame]]:
    sent: list[Frame] = []
    next_id = {"n": 0}

    async def send_frame(frame: Frame):
        sent.append(frame)
        next_id["n"] += 1

    ctx = SlashCommandContext(
        user_id=user_id,
        chat_id="chat-1",
        session_id="sess-1",
        payload={},
        agent_storage_mode="agno",
        send_frame=send_frame,
        next_id_fn=lambda: next_id["n"],
        redis_client=redis_client,
        agno_db=agno_db,
        build_model=build_model,
        db_flags_module=flags,
    )
    return ctx, sent


@pytest.fixture
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ── /reset ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reset_step1_arms_pending_and_shows_preview():
    redis = _FakeRedis()
    ctx, sent = _ctx(redis_client=redis, flags=_FakeFlags())
    await dispatch("/reset", ctx)
    body = sent[0].payload["message"]
    assert "Reply /reset" in body
    assert "LTM" in body and "RAG" in body
    # Pending stored
    key = "cmd:pending:user-1:chat-1"
    assert json.loads(redis.store[key])["cmd"] == "reset"


@pytest.mark.asyncio
async def test_reset_step2_executes_and_clears_flags(monkeypatch):
    redis = _FakeRedis()
    flags = _FakeFlags({"think_level": "high", "compact_summary": "x"})
    db = _FakeAgnoDB()
    ctx, sent = _ctx(redis_client=redis, flags=flags, agno_db=db)
    # Stub the SQL archive helper — no real DB in unit tests.
    from src.server.slash_commands.handlers import reset as reset_mod

    async def fake_archive(chat_id, user_id):
        return 7

    monkeypatch.setattr(reset_mod, "_archive_payload_messages", fake_archive)

    # Step 1
    await dispatch("/reset", ctx)
    sent.clear()
    # Step 2
    await dispatch("/reset", ctx)

    assert db.deleted_session_id == "sess-1"
    assert flags.data == {}  # cleared
    # session_state with empty flags + confirmation text + DONE
    ops = [(f.kind, f.op) for f in sent]
    assert (Kind.META, Op.SESSION_STATE) in ops
    text = next(f.payload["message"] for f in sent if f.op == Op.MESSAGE)
    assert "Reset complete" in text
    assert "7 messages archived" in text
    assert "Agno session deleted" in text
    # Pending was cleared after execution
    assert "cmd:pending:user-1:chat-1" not in redis.store


@pytest.mark.asyncio
async def test_reset_pending_does_not_leak_across_commands():
    """A different command should NOT consume the pending /reset entry."""
    redis = _FakeRedis()
    ctx, sent = _ctx(redis_client=redis, flags=_FakeFlags())
    await dispatch("/reset", ctx)  # arms pending
    sent.clear()
    # Now run /help — must not trigger reset execution
    await dispatch("/help", ctx)
    body = sent[0].payload["message"]
    assert "Available commands" in body
    # Pending still armed
    assert "cmd:pending:user-1:chat-1" in redis.store


# ── /compact ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_compact_no_db():
    ctx, sent = _ctx(flags=_FakeFlags())
    await dispatch("/compact", ctx)
    assert "unavailable" in sent[0].payload["message"]


@pytest.mark.asyncio
async def test_compact_empty_session():
    db = _FakeAgnoDB(session=SimpleNamespace(runs=[]))
    ctx, sent = _ctx(
        flags=_FakeFlags(),
        agno_db=db,
        build_model=lambda name: object(),
    )
    await dispatch("/compact", ctx)
    assert "Nothing to compact" in sent[0].payload["message"]


@pytest.mark.asyncio
async def test_compact_happy_path():
    runs = [
        {"input": "Hi, I'm planning a trip to Tokyo", "content": "Cool, when?"},
        {"input": "Next week", "content": "Got it, suggesting an itinerary..."},
    ]
    db = _FakeAgnoDB(session=SimpleNamespace(runs=runs))
    flags = _FakeFlags()

    class _StubModel:
        async def aresponse(self, messages):
            # Verify the prompt was assembled from runs
            content = messages[0].content
            assert "Tokyo" in content
            assert "USER:" in content
            return SimpleNamespace(content="Trip to Tokyo next week planned.")

    ctx, sent = _ctx(
        flags=flags,
        agno_db=db,
        build_model=lambda name: _StubModel(),
    )
    await dispatch("/compact", ctx)

    assert flags.data["compact_summary"] == "Trip to Tokyo next week planned."
    assert "compact_at" in flags.data
    assert db.deleted_session_id == "sess-1"
    # session_state emitted
    assert any(f.op == Op.SESSION_STATE for f in sent)
    text = next(f.payload["message"] for f in sent if f.op == Op.MESSAGE)
    assert "compacted" in text.lower()


@pytest.mark.asyncio
async def test_compact_summary_failure_propagates_message():
    db = _FakeAgnoDB(
        session=SimpleNamespace(runs=[{"input": "x", "content": "y"}])
    )

    class _BadModel:
        async def aresponse(self, messages):
            raise RuntimeError("rate limited")

    ctx, sent = _ctx(
        flags=_FakeFlags(),
        agno_db=db,
        build_model=lambda name: _BadModel(),
    )
    await dispatch("/compact", ctx)
    body = sent[0].payload["message"]
    assert "failed" in body.lower()
    assert "rate limited" in body


# ── /help should now list new commands ───────────────────


@pytest.mark.asyncio
async def test_help_includes_phase4_commands():
    ctx, sent = _ctx()
    await dispatch("/help", ctx)
    body = sent[0].payload["message"]
    assert "/reset" in body
    assert "/compact" in body
