"""E2E: the background agent-task lifecycle (create -> events -> done) and stop."""

import asyncio


async def _poll_task(api, task_id: str, *, until, timeout: float = 30.0) -> dict:
    """Poll GET /api/tasks/:id until ``until(body)`` is true; return the body."""
    deadline = asyncio.get_event_loop().time() + timeout
    body: dict = {}
    while asyncio.get_event_loop().time() < deadline:
        resp = await api.get(f"/api/tasks/{task_id}")
        resp.raise_for_status()
        body = resp.json()
        if until(body):
            return body
        await asyncio.sleep(0.5)
    raise AssertionError(f"task {task_id} never reached condition: {body}")


async def test_task_lifecycle_and_events(api):
    resp = await api.post("/api/tasks", json={"goal": "__e2e_task__"})
    assert resp.status_code == 201, resp.text
    task = resp.json()
    task_id = task["id"]
    assert task["status"] == "planning"

    body = await _poll_task(api, task_id, until=lambda b: b["task"]["status"] == "done")

    # Status reached the terminal 'done', and the event log persisted in order.
    events = body["events"]
    assert events, "no task events persisted"
    seqs = [e["seq"] for e in events]
    assert seqs == sorted(seqs), seqs
    kinds = [e["kind"] for e in events]
    assert "plan_update" in kinds
    assert kinds.count("step_started") == 3
    assert kinds.count("step_done") == 3
    assert kinds[-1] == "done"


async def test_task_stop_accepted(api):
    task_id = (await api.post("/api/tasks", json={"goal": "__e2e_task__"})).json()["id"]
    resp = await api.post(f"/api/tasks/{task_id}/stop")
    # Stop is fire-and-forget (publishes a STOP frame), so the contract is 202.
    assert resp.status_code == 202, resp.text
