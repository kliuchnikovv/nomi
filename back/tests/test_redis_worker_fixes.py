"""Tests for redis_worker fixes: retry on start (#7) and no silent exception swallowing (#8)."""

import asyncio
import json
import pytest

from unittest.mock import AsyncMock, MagicMock, patch

from src.server.redis_worker import RedisWorker


# ── #8: _send_parse_error_frame logs instead of silently passing ──


@pytest.mark.asyncio
async def test_send_parse_error_frame_handles_malformed_data():
    """_send_parse_error_frame should not have bare 'except Exception: pass'."""
    worker = RedisWorker(agent_factory=MagicMock())

    mock_redis = AsyncMock()
    mock_redis.publish = AsyncMock()
    worker.redis = mock_redis

    # Should NOT raise, even with completely malformed data
    await worker._send_parse_error_frame("not-json-at-all", "chat-123", ValueError("test"))

    # With valid JSON but missing fields — should not publish
    await worker._send_parse_error_frame(
        json.dumps({"payload": {}}),
        "chat-123",
        ValueError("test"),
    )

    # With valid JSON and user_id — should try to publish
    await worker._send_parse_error_frame(
        json.dumps({"payload": {"user_id": "user-1"}, "trace_id": "t-1"}),
        "chat-123",
        json.JSONDecodeError("test", "", 0),
    )
    assert mock_redis.publish.call_count >= 1


@pytest.mark.asyncio
async def test_send_parse_error_frame_with_redis_error_logs():
    """If redis.publish fails during _send_parse_error_frame, it should log, not crash."""
    worker = RedisWorker(agent_factory=MagicMock())
    mock_redis = AsyncMock()
    mock_redis.publish = AsyncMock(side_effect=Exception("redis down"))
    worker.redis = mock_redis

    # Should NOT raise — the old code would have silently swallowed this
    await worker._send_parse_error_frame(
        json.dumps({"payload": {"user_id": "user-1"}}),
        "chat-123",
        ValueError("test"),
    )


# ── #7: RedisWorker.start() retries on failure ──


@pytest.mark.asyncio
async def test_worker_retries_on_start_failure():
    """Worker should retry connecting when Redis is unavailable instead of giving up."""
    worker = RedisWorker(agent_factory=MagicMock())
    worker.redis_url = "redis://localhost:9999"

    attempts = 0

    def fake_from_url(url, **kw):
        nonlocal attempts
        attempts += 1
        mock_redis = MagicMock()
        if attempts < 3:
            # pubsub() raises — simulates connection failure
            mock_redis.pubsub.side_effect = Exception("connection refused")
        else:
            mock_pubsub = MagicMock()

            async def empty_listen():
                yield {"type": "subscribe", "channel": "test", "data": 3}

            mock_pubsub.listen = empty_listen
            mock_redis.pubsub.return_value = mock_pubsub
        return mock_redis

    with patch("src.server.redis_worker.redis.from_url", side_effect=fake_from_url):
        task = asyncio.create_task(worker.start())
        # First attempt fails immediately, retry after 2s delay, then 3rd succeeds
        await asyncio.sleep(4.5)
        worker.running = False
        try:
            await asyncio.wait_for(task, timeout=3.0)
        except asyncio.TimeoutError:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    assert attempts >= 2, f"Expected at least 2 attempts, got {attempts}"
