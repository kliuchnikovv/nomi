"""Tests for the autonomous TaskRunner plan->execute loop."""

import asyncio
import json
import re

import pytest

import src.server.task_runner as task_runner
from src.server.task_runner import TaskRunner, _parse_coding_plan, _parse_steps


@pytest.fixture(autouse=True)
def _fast_retry(monkeypatch):
    """Keep per-step retry backoff at 0 so failure/retry tests stay fast."""
    monkeypatch.setattr(task_runner, "STEP_RETRY_BACKOFF_S", 0)


class FakeAgent:
    """Stub agent.

    A planning prompt (no "Current step" marker) returns ``plan_json``; a step
    prompt returns ``"did step N"``. Keys behaviour on the step number parsed
    from the prompt (not the call count) so per-step retries — which re-issue
    the SAME step prompt — are handled correctly. ``fail_on_step`` (1-based)
    fails that step; ``fail_times`` fails it that many times then succeeds
    (``None`` = always fail).
    """

    def __init__(
        self,
        plan_json: str,
        *,
        fail_on_step: int | None = None,
        fail_times: int | None = None,
    ):
        self._plan_json = plan_json
        self._fail_on_step = fail_on_step
        self._fail_times = fail_times
        self._attempts: dict[int, int] = {}
        self.prompts: list[str] = []

    async def arun(self, prompt: str, **kwargs):
        self.prompts.append(prompt)

        class _R:
            content = ""

        r = _R()
        if "Current step" not in prompt:
            r.content = self._plan_json
            return r
        m = re.search(r"Current step (\d+)/", prompt)
        step_no = int(m.group(1)) if m else 0
        if self._fail_on_step is not None and step_no == self._fail_on_step:
            self._attempts[step_no] = self._attempts.get(step_no, 0) + 1
            if self._fail_times is None or self._attempts[step_no] <= self._fail_times:
                raise RuntimeError("boom")
        r.content = f"did step {step_no}"
        return r


class FakeRedis:
    """Captures publishes and backs the steer/approval lists for tests."""

    def __init__(self):
        self.published: list[tuple[str, str]] = []
        self.lists: dict[str, list[str]] = {}

    async def publish(self, channel: str, data: str):
        self.published.append((channel, data))

    async def rpush(self, key: str, value: str):
        self.lists.setdefault(key, []).append(value)

    async def lpop(self, key: str):
        lst = self.lists.get(key)
        if not lst:
            return None
        return lst.pop(0)

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
        async def arun(self, prompt: str, **kwargs):
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
async def test_runner_absorbs_steering():
    redis = FakeRedis()
    # Queue a steering message before the run starts.
    await redis.rpush(
        "agent:task:steer:task-s",
        json.dumps({"message": "skip the linter"}),
    )
    agent = FakeAgent(json.dumps(["Clone repo", "Run tests"]))
    runner = TaskRunner(
        redis=redis,
        task_id="task-s",
        user_id="u",
        chat_id="c",
        goal="g",
        agent=agent,
    )

    await runner.run()

    msgs = redis.task_msgs("task-s")
    logs = [m for m in msgs if m.get("event", {}).get("kind") == "log"]
    assert any("skip the linter" in m["event"]["payload"]["message"] for m in logs)
    # Guidance is threaded into a step prompt.
    assert any("skip the linter" in p for p in agent.prompts)


@pytest.mark.asyncio
async def test_runner_approval_approve_runs_risky_step():
    redis = FakeRedis()
    await redis.rpush(
        "agent:task:approval:task-a", json.dumps({"approved": True})
    )
    agent = FakeAgent(json.dumps(["Push to main"]))
    runner = TaskRunner(
        redis=redis, task_id="task-a", user_id="u", chat_id="c", goal="g", agent=agent
    )

    await runner.run()

    msgs = redis.task_msgs("task-a")
    kinds = [m["event"]["kind"] for m in msgs if "event" in m]
    assert "approval_request" in kinds
    assert "step_started" in kinds  # approved → executed
    assert msgs[-1]["status"] == "done"


@pytest.mark.asyncio
async def test_runner_approval_reject_skips_risky_step():
    redis = FakeRedis()
    await redis.rpush(
        "agent:task:approval:task-r", json.dumps({"approved": False})
    )
    agent = FakeAgent(json.dumps(["Deploy to production"]))
    runner = TaskRunner(
        redis=redis, task_id="task-r", user_id="u", chat_id="c", goal="g", agent=agent
    )

    await runner.run()

    msgs = redis.task_msgs("task-r")
    kinds = [m["event"]["kind"] for m in msgs if "event" in m]
    assert "approval_request" in kinds
    assert "step_started" not in kinds  # rejected → never executed
    done = [m for m in msgs if m.get("event", {}).get("kind") == "step_done"]
    assert any("skipped" in m["event"]["payload"].get("result", "") for m in done)


def test_parse_steps_falls_back_to_goal_on_garbage():
    assert _parse_steps("not json", "my goal") == ["my goal"]
    assert _parse_steps('["a", "b"]', "g") == ["a", "b"]
    # Extracts the array even with surrounding prose.
    assert _parse_steps('Here you go: ["x", "y"] done', "g") == ["x", "y"]


def test_parse_coding_plan():
    raw = (
        'noise {"questions": [{"q": "Which?", "opts": ["A", "B"]}], '
        '"plan": ["one", "two"]} trailing'
    )
    questions, titles = _parse_coding_plan(raw, "goal")
    assert questions == [{"q": "Which?", "opts": ["A", "B"]}]
    assert titles == ["one", "two"]
    # Garbage falls back to a single step (the goal) and no questions.
    assert _parse_coding_plan("nope", "g") == ([], ["g"])


@pytest.mark.asyncio
async def test_step_retry_then_success():
    redis = FakeRedis()
    # Step 1 fails once, then succeeds on retry.
    agent = FakeAgent(json.dumps(["only step"]), fail_on_step=1, fail_times=1)
    runner = TaskRunner(
        redis=redis, task_id="task-rt", user_id="u", chat_id="c", goal="g", agent=agent
    )
    await runner.run()

    msgs = redis.task_msgs("task-rt")
    logs = [m for m in msgs if m.get("event", {}).get("kind") == "log"]
    assert any(
        "attempt 1/" in m["event"]["payload"].get("message", "") for m in logs
    )
    assert msgs[-1]["status"] == "done"  # retry recovered → task completes


@pytest.mark.asyncio
async def test_step_retry_exhausted_marks_failed():
    redis = FakeRedis()
    agent = FakeAgent(json.dumps(["only step"]), fail_on_step=1)  # always fails
    runner = TaskRunner(
        redis=redis, task_id="task-rx", user_id="u", chat_id="c", goal="g", agent=agent
    )
    await runner.run()

    msgs = redis.task_msgs("task-rx")
    assert msgs[-1]["status"] == "failed"
    assert msgs[-1]["finished"] is True
    # Exactly STEP_MAX_ATTEMPTS attempts were logged.
    attempts = [
        m
        for m in msgs
        if "attempt" in m.get("event", {}).get("payload", {}).get("message", "")
    ]
    assert len(attempts) == task_runner.STEP_MAX_ATTEMPTS


@pytest.mark.asyncio
async def test_run_resume_skips_completed_steps():
    redis = FakeRedis()
    plan = [
        {"id": 0, "title": "a", "status": "done", "result": "done a"},
        {"id": 1, "title": "b", "status": "pending", "result": ""},
        {"id": 2, "title": "c", "status": "pending", "result": ""},
    ]
    agent = FakeAgent("[]")  # planner is never called on resume
    runner = TaskRunner(
        redis=redis,
        task_id="task-res",
        user_id="u",
        chat_id="c",
        goal="g",
        agent=agent,
        resume_state={
            "plan": plan,
            "current_step": 1,
            "attempt": 0,
            "last_seq": 5,
            "guidance": [],
        },
    )
    await runner.run()

    # Only steps 2 and 3 (1-based) execute; step 1 keeps its persisted result.
    assert any("Current step 2/3" in p for p in agent.prompts)
    assert any("Current step 3/3" in p for p in agent.prompts)
    assert not any("Current step 1/3" in p for p in agent.prompts)
    # Rehydrated context from the completed step reaches the next step's prompt.
    assert any("done a" in p for p in agent.prompts)
    msgs = redis.task_msgs("task-res")
    assert msgs[-1]["status"] == "done"
    # Re-emitted events start above the persisted last_seq (monotonic).
    seqs = [m["event"]["seq"] for m in msgs if "event" in m]
    assert seqs and min(seqs) > 5


@pytest.mark.asyncio
async def test_run_resume_reemits_pending_approval():
    redis = FakeRedis()
    # The pre-crash approval answer is still queued; resume must consume it
    # using the SAME request_id, so the risky step runs without re-asking.
    await redis.rpush(
        "agent:task:approval:task-rp",
        json.dumps({"request_id": "req-1", "approved": True}),
    )
    plan = [{"id": 0, "title": "Push to main", "status": "pending", "result": ""}]
    agent = FakeAgent("[]")
    runner = TaskRunner(
        redis=redis,
        task_id="task-rp",
        user_id="u",
        chat_id="c",
        goal="g",
        agent=agent,
        resume_state={
            "plan": plan,
            "current_step": 0,
            "attempt": 0,
            "last_seq": 2,
            "pending_approval": {"request_id": "req-1", "step_id": 0},
        },
    )
    await runner.run()

    msgs = redis.task_msgs("task-rp")
    approvals = [
        m for m in msgs if m.get("event", {}).get("kind") == "approval_request"
    ]
    assert approvals and approvals[0]["event"]["payload"]["request_id"] == "req-1"
    kinds = [m["event"]["kind"] for m in msgs if "event" in m]
    assert "step_started" in kinds  # answer consumed → step executed
    assert msgs[-1]["status"] == "done"


@pytest.mark.asyncio
async def test_coding_flow_plan_clarify_approve_execute():
    redis = FakeRedis()
    await redis.rpush(
        "agent:task:clarify:task-cd", json.dumps({"answer": "use option A"})
    )
    await redis.rpush(
        "agent:task:approval:task-cd", json.dumps({"approved": True})
    )
    coding_json = json.dumps(
        {
            "questions": [{"q": "Which option?", "opts": ["A", "B"]}],
            "plan": ["Edit backend", "Edit frontend"],
        }
    )
    agent = FakeAgent(coding_json)
    runner = TaskRunner(
        redis=redis,
        task_id="task-cd",
        user_id="u",
        chat_id="c",
        goal="g",
        agent=agent,
        task_kind="coding",
        repo={"owner": "o", "repo": "r", "ref": None},
    )
    await runner.run()

    msgs = redis.task_msgs("task-cd")
    kinds = [m["event"]["kind"] for m in msgs if "event" in m]
    assert "clarify_request" in kinds
    assert "approval_request" in kinds  # plan-level gate
    assert kinds.count("step_started") == 2
    assert msgs[-1]["status"] == "done"
    # The clarification answer is threaded into the coding step prompts.
    assert any("use option A" in p for p in agent.prompts)


@pytest.mark.asyncio
async def test_coding_flow_plan_rejected_stops():
    redis = FakeRedis()
    await redis.rpush(
        "agent:task:approval:task-cr", json.dumps({"approved": False})
    )
    coding_json = json.dumps({"questions": [], "plan": ["Edit backend"]})
    agent = FakeAgent(coding_json)
    runner = TaskRunner(
        redis=redis,
        task_id="task-cr",
        user_id="u",
        chat_id="c",
        goal="g",
        agent=agent,
        task_kind="coding",
        repo={"owner": "o", "repo": "r", "ref": None},
    )
    await runner.run()

    msgs = redis.task_msgs("task-cr")
    kinds = [m["event"]["kind"] for m in msgs if "event" in m]
    assert "step_started" not in kinds  # rejected before any code was written
    assert msgs[-1]["status"] == "cancelled"


@pytest.mark.asyncio
async def test_coding_clarify_timeout_cancels(monkeypatch):
    monkeypatch.setattr(task_runner, "CLARIFY_TIMEOUT_S", 0)
    redis = FakeRedis()  # no clarify answer queued
    coding_json = json.dumps(
        {"questions": [{"q": "Which?", "opts": []}], "plan": ["Edit"]}
    )
    agent = FakeAgent(coding_json)
    runner = TaskRunner(
        redis=redis,
        task_id="task-ct",
        user_id="u",
        chat_id="c",
        goal="g",
        agent=agent,
        task_kind="coding",
        repo={"owner": "o", "repo": "r"},
    )
    await runner.run()

    msgs = redis.task_msgs("task-ct")
    assert msgs[-1]["status"] == "cancelled"
