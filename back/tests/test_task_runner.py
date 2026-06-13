"""Tests for the autonomous TaskRunner plan->execute loop."""

import asyncio
import json

import pytest

from src.server.task_runner import TaskRunner, _parse_steps


class FakeAgent:
    """Stub agent: first arun returns a plan JSON, the rest return step text."""

    def __init__(self, plan_json: str, *, fail_on_step: int | None = None):
        self._plan_json = plan_json
        self._calls = 0
        self._fail_on_step = fail_on_step

    async def arun(self, prompt: str):
        self._calls += 1

        class _R:
            content = ""

        r = _R()
        if self._calls == 1:
            r.content = self._plan_json
        else:
            step_ix = self._calls - 1  # 1-based step number
            if self._fail_on_step is not None and step_ix == self._fail_on_step:
                raise RuntimeError("boom")
            r.content = f"did step {step_ix}"
        return r


class FakeRedis:
    """Captures publishes so the test can assert on the emitted messages."""

    def __init__(self):
        self.published: list[tuple[str, str]] = []

    async def publish(self, channel: str, data: str):
        self.published.append((channel, data))

    def task_msgs(self, task_id: str) -> list[dict]:
        """Decoded persistence messages for a task, in order."""
        prefix = f"agent:task:event:{task_id}"
        return [json.loads(d) for ch, d in self.published if ch == prefix]


def _parse_steps_array():
    return json.dumps(["Clone repo", "Run tests", "Fix failures"])


@pytest.mark.asyncio
async def test_runner_emits_plan_then_steps_then_done():
    redis = FakeRedis()
    agent = FakeAgent(_parse_steps_array())
    runner = TaskRunner(
        redis=redis,
        task_id="task-1",
        user_id="user-1",
        chat_id="chat-1",
        goal="ship feature",
        agent=agent,
    )

    await runner.run()

    msgs = redis.task_msgs("task-1")
    statuses = [m["status"] for m in msgs]
    assert statuses[0] == "planning"
    assert "running" in statuses
    assert statuses[-1] == "done"
    assert msgs[-1]["finished"] is True

    kinds = [m["event"]["kind"] for m in msgs if "event" in m]
    assert kinds[0] == "plan_update"
    assert kinds.count("step_started") == 3
    assert kinds.count("step_done") == 3
    assert kinds[-1] == "done"

    # The final persistence message carries the plan with all steps done.
    final_plan = msgs[-1]["plan"]
    assert len(final_plan) == 3
    assert all(s["status"] == "done" for s in final_plan)


@pytest.mark.asyncio
async def test_runner_reports_failure():
    redis = FakeRedis()
    agent = FakeAgent(_parse_steps_array(), fail_on_step=2)
    runner = TaskRunner(
        redis=redis,
        task_id="task-2",
        user_id="user-1",
        chat_id="chat-1",
        goal="ship feature",
        agent=agent,
    )

    await runner.run()  # failure is reported, not raised

    msgs = redis.task_msgs("task-2")
    assert msgs[-1]["status"] == "failed"
    assert msgs[-1]["finished"] is True


@pytest.mark.asyncio
async def test_runner_cancellation_marks_cancelled_and_reraises():
    redis = FakeRedis()

    class HangingAgent:
        async def arun(self, prompt: str):
            await asyncio.sleep(10)

    runner = TaskRunner(
        redis=redis,
        task_id="task-3",
        user_id="user-1",
        chat_id="chat-1",
        goal="ship feature",
        agent=HangingAgent(),
    )

    task = asyncio.create_task(runner.run())
    await asyncio.sleep(0.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    msgs = redis.task_msgs("task-3")
    assert msgs[-1]["status"] == "cancelled"
    assert msgs[-1]["finished"] is True


@pytest.mark.asyncio
async def test_background_task_tool_invokes_spawner():
    from src.tools.background_task import BackgroundTaskTools

    seen = {}

    async def fake_spawner(goal: str) -> str:
        seen["goal"] = goal
        return "task-xyz"

    tool = BackgroundTaskTools(spawner=fake_spawner)
    msg = await tool.start_background_task("clone repo and fix tests")

    assert seen["goal"] == "clone repo and fix tests"
    assert "task-xyz" in msg


@pytest.mark.asyncio
async def test_background_task_tool_reports_spawn_failure():
    from src.tools.background_task import BackgroundTaskTools

    async def boom(goal: str) -> str:
        raise RuntimeError("redis down")

    tool = BackgroundTaskTools(spawner=boom)
    msg = await tool.start_background_task("do thing")
    assert "Failed to start" in msg


def test_parse_steps_falls_back_to_goal_on_garbage():
    assert _parse_steps("not json", "my goal") == ["my goal"]
    assert _parse_steps('["a", "b"]', "g") == ["a", "b"]
    # Extracts the array even with surrounding prose.
    assert _parse_steps('Here you go: ["x", "y"] done', "g") == ["x", "y"]
