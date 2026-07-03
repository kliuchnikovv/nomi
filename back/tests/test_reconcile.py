"""Tests for RedisWorker.reconcile_unfinished_tasks (boot recovery)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.server.redis_worker import RedisWorker


def _worker() -> RedisWorker:
    return RedisWorker(agent_factory=MagicMock())


def _async_client(get_return=None, get_side_effect=None):
    """Build a mock usable as ``async with httpx.AsyncClient(...) as client``."""
    client = MagicMock()
    if get_side_effect is not None:
        client.get = AsyncMock(side_effect=get_side_effect)
    else:
        client.get = AsyncMock(return_value=get_return)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client


def test_relaunch_builds_resume_payload():
    w = _worker()
    captured: dict = {}
    w._launch_task_run = lambda tid, payload: captured.update(
        {"tid": tid, "payload": payload}
    )

    w._relaunch_task_run(
        {
            "task_id": "t1",
            "user_id": "u",
            "chat_id": "c",
            "goal": "g",
            "status": "running",
            "plan": [{"id": 0, "title": "x"}],
            "current_step": 1,
            "attempt": 2,
            "pending_approval": {"request_id": "r", "step_id": 1},
            "last_seq": 9,
            "guidance": ["User guidance: x"],
        }
    )

    assert captured["tid"] == "t1"
    payload = captured["payload"]
    assert payload["goal"] == "g"
    assert payload["chat_id"] == "c"
    rs = payload["resume_state"]
    assert rs["current_step"] == 1
    assert rs["attempt"] == 2
    assert rs["last_seq"] == 9
    assert rs["pending_approval"]["request_id"] == "r"
    assert rs["guidance"] == ["User guidance: x"]


@pytest.mark.asyncio
async def test_reconcile_relaunches_and_dedupes():
    w = _worker()
    # A task already running here must not be relaunched.
    w.active_task_runs = {"t_active": object()}
    relaunched: list[str] = []
    w._relaunch_task_run = lambda t: relaunched.append(t["task_id"])

    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json = MagicMock(
        return_value={
            "tasks": [
                {"task_id": "t1"},
                {"task_id": "t_active"},  # deduped
                {"task_id": ""},  # skipped (no id)
            ]
        }
    )
    with patch("httpx.AsyncClient", return_value=_async_client(get_return=resp)):
        await w.reconcile_unfinished_tasks()

    assert relaunched == ["t1"]


@pytest.mark.asyncio
async def test_reconcile_survives_go_unreachable():
    w = _worker()
    w._relaunch_task_run = MagicMock(
        side_effect=AssertionError("must not relaunch on fetch failure")
    )
    with patch(
        "httpx.AsyncClient",
        return_value=_async_client(get_side_effect=RuntimeError("no go")),
    ):
        await w.reconcile_unfinished_tasks()  # must not raise

    w._relaunch_task_run.assert_not_called()
