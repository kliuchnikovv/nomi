"""Phase 5: /forget two-step substring match against Agno memory store."""

from __future__ import annotations

import asyncio

import pytest

from src.server.models import Frame, Op
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


class _FakeMemoryDB:
    def __init__(self, memories: list[dict] | None = None):
        self.memories = list(memories or [])
        self.deleted: list[str] = []
        self.last_search: str | None = None

    def get_user_memories(self, *, user_id, search_content, limit, **kw):
        self.last_search = search_content
        s = (search_content or "").lower()
        matches = [m for m in self.memories if s in m["memory"].lower()]
        return matches[:limit]

    def delete_user_memories(self, memory_ids, user_id=None):
        self.deleted.extend(memory_ids)
        self.memories = [m for m in self.memories if m["memory_id"] not in memory_ids]


def _ctx(*, db=None, redis_client=None, user_id="user-1"):
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
        agno_db=db,
    )
    return ctx, sent


@pytest.fixture
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.mark.asyncio
async def test_forget_no_arg():
    ctx, sent = _ctx(db=_FakeMemoryDB())
    await dispatch("/forget", ctx)
    assert "Usage" in sent[0].payload["message"]


@pytest.mark.asyncio
async def test_forget_no_db():
    ctx, sent = _ctx()
    await dispatch("/forget anything", ctx)
    assert "unavailable" in sent[0].payload["message"]


@pytest.mark.asyncio
async def test_forget_no_matches():
    db = _FakeMemoryDB([{"memory_id": "m1", "memory": "loves cats"}])
    ctx, sent = _ctx(db=db, redis_client=_FakeRedis())
    await dispatch("/forget dragons", ctx)
    assert "No memories matching 'dragons'" in sent[0].payload["message"]


@pytest.mark.asyncio
async def test_forget_too_broad():
    db = _FakeMemoryDB([{"memory_id": f"m{i}", "memory": "the user likes X"} for i in range(15)])
    redis = _FakeRedis()
    ctx, sent = _ctx(db=db, redis_client=redis)
    await dispatch("/forget the", ctx)
    body = sent[0].payload["message"]
    assert "more than" in body.lower()
    # No pending armed when too broad
    assert "cmd:pending:user-1:chat-1" not in redis.store


@pytest.mark.asyncio
async def test_forget_two_step_happy_path():
    mems = [
        {"memory_id": "m1", "memory": "User's mom is named Ann"},
        {"memory_id": "m2", "memory": "Birthday gift for mom on May 10"},
    ]
    db = _FakeMemoryDB(mems)
    redis = _FakeRedis()
    ctx, sent = _ctx(db=db, redis_client=redis)

    # Step 1
    await dispatch("/forget mom", ctx)
    body = sent[0].payload["message"]
    assert "Found 2 memories" in body
    assert "Ann" in body
    assert "May 10" in body
    assert "cmd:pending:user-1:chat-1" in redis.store
    sent.clear()

    # Step 2 — same substring
    await dispatch("/forget mom", ctx)
    body = sent[0].payload["message"]
    assert "Forgot 2 memories" in body
    assert sorted(db.deleted) == ["m1", "m2"]
    # Pending cleared
    assert "cmd:pending:user-1:chat-1" not in redis.store


@pytest.mark.asyncio
async def test_forget_step2_uses_captured_ids_not_re_search():
    """Memories created between step 1 and step 2 must NOT be swept."""
    db = _FakeMemoryDB([{"memory_id": "m1", "memory": "loves coffee"}])
    redis = _FakeRedis()
    ctx, sent = _ctx(db=db, redis_client=redis)
    await dispatch("/forget coffee", ctx)
    sent.clear()
    # Simulate a new memory created between steps
    db.memories.append({"memory_id": "m2", "memory": "ordered coffee today"})
    await dispatch("/forget coffee", ctx)
    # Only the originally captured id was deleted
    assert db.deleted == ["m1"]
    # The new one survived
    assert any(m["memory_id"] == "m2" for m in db.memories)


@pytest.mark.asyncio
async def test_forget_pending_does_not_leak_to_other_substring():
    db = _FakeMemoryDB([
        {"memory_id": "m1", "memory": "loves coffee"},
        {"memory_id": "m2", "memory": "ordered tea"},
    ])
    redis = _FakeRedis()
    ctx, sent = _ctx(db=db, redis_client=redis)
    await dispatch("/forget coffee", ctx)  # arms pending for "coffee"
    sent.clear()
    await dispatch("/forget tea", ctx)  # different substring — should treat as step 1
    body = sent[0].payload["message"]
    assert "Found 1 memories" in body or "Found 1 memory" in body or "Found 1" in body
    assert db.deleted == []  # nothing deleted yet


@pytest.mark.asyncio
async def test_help_includes_forget():
    ctx, sent = _ctx()
    await dispatch("/help", ctx)
    assert "/forget" in sent[0].payload["message"]
    assert "<substring>" in sent[0].payload["message"]


@pytest.mark.asyncio
async def test_forget_emits_done():
    db = _FakeMemoryDB()
    ctx, sent = _ctx(db=db, redis_client=_FakeRedis())
    await dispatch("/forget x", ctx)
    assert sent[-1].op == Op.DONE
