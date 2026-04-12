"""Tests for redis_session fixes: params mutation (#9) and sync iterator fallback (#11)."""

import asyncio
import pytest

from unittest.mock import AsyncMock, MagicMock

from src.server.redis_session import RedisSession


# ── #9: _send_client_action_and_wait does not mutate params ──


@pytest.mark.asyncio
async def test_send_client_action_does_not_mutate_params():
    """params.pop('integration_id') was mutating the caller's dict.
    After the fix, params.get() preserves the original dict."""

    factory = MagicMock()
    session = RedisSession(
        agent_factory=factory,
        session_id="test-session",
        user_id="user-1",
        chat_id="chat-1",
    )

    # Mock redis client and frame sending
    mock_redis = AsyncMock()
    mock_redis.setex = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)
    session.redis_client = mock_redis
    session._send_frame = AsyncMock()

    # Create params with integration_id
    original_params = {"integration_id": "int-123", "key": "value"}

    # Run in background — it will block waiting for result
    task = asyncio.create_task(
        session._send_client_action_and_wait("test_tool", "method", original_params.copy())
    )

    # Give it a moment to register the future
    await asyncio.sleep(0.1)

    # Resolve all pending futures to unblock
    for call_id, future in list(session.pending_client_tool_results.items()):
        if not future.done():
            future.set_result("test result")

    try:
        await asyncio.wait_for(task, timeout=2.0)
    except asyncio.TimeoutError:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    # The original params dict should NOT have integration_id removed
    assert "integration_id" in original_params, \
        "params was mutated: integration_id was removed from the caller's dict"
    assert original_params["integration_id"] == "int-123"
    assert original_params["key"] == "value"


# ── #11: Sync iterator fallback yields text events ──


@pytest.mark.asyncio
async def test_sync_iterator_fallback_yields_events():
    """After the fix, sync iterator results should be yielded as text events, not discarded."""

    factory = MagicMock()
    session = RedisSession(
        agent_factory=factory,
        session_id="test-session",
        user_id="user-1",
        chat_id="chat-1",
    )
    session.agent = MagicMock()
    session.cancel_event = asyncio.Event()

    # Create a sync iterator that yields chunks (no __aiter__)
    class SyncResult:
        def __init__(self, items):
            self._items = items
            self._idx = 0

        def __iter__(self):
            return self

        def __next__(self):
            if self._idx >= len(self._items):
                raise StopIteration
            item = self._items[self._idx]
            self._idx += 1
            return item

    result = SyncResult(["Hello", " World", "!"])

    events = []
    async for event in session._iterate_agent_stream(result):
        events.append(event)

    assert len(events) == 3, f"Expected 3 events, got {len(events)}"
    assert events[0]["type"] == "text"
    assert events[0]["content"] == "Hello"
    assert events[1]["content"] == " World"
    assert events[2]["content"] == "!"


@pytest.mark.asyncio
async def test_single_value_fallback():
    """Single non-iterable value should be yielded as text."""

    factory = MagicMock()
    session = RedisSession(
        agent_factory=factory,
        session_id="test-session",
        user_id="user-1",
        chat_id="chat-1",
    )
    session.agent = MagicMock()
    session.cancel_event = asyncio.Event()

    events = []
    async for event in session._iterate_agent_stream("single response"):
        events.append(event)

    assert len(events) == 1
    assert events[0]["type"] == "text"
    assert events[0]["content"] == "single response"
