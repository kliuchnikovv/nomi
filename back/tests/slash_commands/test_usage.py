"""Phase 3: /usage — reads usage:last:{user_id} from Redis."""

from __future__ import annotations

import asyncio
import json
import time

import pytest

from src.server.models import Frame, Op
from src.server.slash_commands import SlashCommandContext, dispatch


class _FakeRedis:
    def __init__(self, data: dict | None = None):
        self.store: dict = dict(data or {})

    async def get(self, key: str):
        return self.store.get(key)

    async def set(self, key: str, value, ex=None):
        self.store[key] = value


def _ctx(redis_client=None, user_id: str | None = "user-1") -> tuple[SlashCommandContext, list[Frame]]:
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
    )
    return ctx, sent


@pytest.fixture
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.mark.asyncio
async def test_usage_no_redis():
    ctx, sent = _ctx(redis_client=None)
    await dispatch("/usage", ctx)
    body = sent[0].payload["message"]
    assert "No usage data" in body


@pytest.mark.asyncio
async def test_usage_no_data():
    ctx, sent = _ctx(redis_client=_FakeRedis())
    await dispatch("/usage", ctx)
    assert "Send a message" in sent[0].payload["message"]


@pytest.mark.asyncio
async def test_usage_formatted():
    data = {
        "model": "claude-opus-4-7",
        "input_tokens": 1234,
        "output_tokens": 567,
        "total_tokens": 1801,
        "reasoning_tokens": 42,
        "cache_read_tokens": 100,
        "cost": 0.01234,
        "captured_at": int(time.time()) - 30,
    }
    redis = _FakeRedis({"usage:last:user-1": json.dumps(data)})
    ctx, sent = _ctx(redis_client=redis)
    await dispatch("/usage", ctx)
    body = sent[0].payload["message"]
    assert "claude-opus-4-7" in body
    assert "1234" in body
    assert "567" in body
    assert "1801" in body
    assert "42" in body
    assert "$0.01234" in body
    # Age formatting
    assert "s ago" in body or "m ago" in body


@pytest.mark.asyncio
async def test_usage_bytes_value_from_redis():
    data = {"model": "x", "input_tokens": 1, "output_tokens": 2, "total_tokens": 3, "captured_at": 0}
    redis = _FakeRedis({"usage:last:user-1": json.dumps(data).encode("utf-8")})
    ctx, sent = _ctx(redis_client=redis)
    await dispatch("/usage", ctx)
    body = sent[0].payload["message"]
    assert "model:" in body
    assert "x" in body


@pytest.mark.asyncio
async def test_usage_corrupted():
    redis = _FakeRedis({"usage:last:user-1": "not json"})
    ctx, sent = _ctx(redis_client=redis)
    await dispatch("/usage", ctx)
    assert "corrupted" in sent[0].payload["message"]


@pytest.mark.asyncio
async def test_help_lists_usage():
    ctx, sent = _ctx(redis_client=None)
    await dispatch("/help", ctx)
    assert "/usage" in sent[0].payload["message"]


@pytest.mark.asyncio
async def test_dispatch_emits_done_after_usage():
    ctx, sent = _ctx(redis_client=None)
    await dispatch("/usage", ctx)
    assert sent[-1].op == Op.DONE
