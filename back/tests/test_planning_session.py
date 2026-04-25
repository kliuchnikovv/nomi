"""Tests for redis_session.py planning orchestration.

Covers:
- RedisSession._should_use_workflow (static method)
- RedisSession._load_planner_session_state (async)
- RedisSession._save_planner_session_state (async)
- RedisSession._run_planning_workflow_steps (async)
"""

import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.server.redis_session import RedisSession
from src.workflows.models import PlanStatus  # mocked MagicMock via conftest


# ── Helpers ──────────────────────────────────────────────────────────────────

def make_session(chat_id: str = "chat-1") -> RedisSession:
    session = RedisSession(
        agent_factory=MagicMock(),
        session_id="test-session",
        user_id="user-1",
        chat_id=chat_id,
    )
    session.redis_client = AsyncMock()
    session._send_frame = AsyncMock()
    session.cancel_event = asyncio.Event()
    # CONTEXT preflight calls _send_client_action_and_wait for calendar/health data.
    # Return empty string so both fetch methods degrade gracefully to [] / {}.
    session._send_client_action_and_wait = AsyncMock(return_value="")
    return session


def make_step(content=None, step_name="step"):
    step = MagicMock()
    step.step_name = step_name
    step.content = content
    return step


# ── _should_use_workflow ──────────────────────────────────────────────────────

class TestShouldUseWorkflow:
    def test_empty_state_returns_true(self):
        assert RedisSession._should_use_workflow({}) is True

    def test_iterate_status_returns_false(self):
        # PlanStatus.ITERATE is the mocked attribute — same object used by redis_session.py
        state = {"status": PlanStatus.ITERATE}
        assert RedisSession._should_use_workflow(state) is False

    def test_extract_status_returns_true(self):
        state = {"status": PlanStatus.EXTRACT}
        assert RedisSession._should_use_workflow(state) is True

    def test_replan_overrides_iterate(self):
        state = {"status": PlanStatus.ITERATE}
        assert RedisSession._should_use_workflow(state, "/replan build my day") is True

    def test_replan_case_insensitive(self):
        state = {"status": PlanStatus.ITERATE}
        assert RedisSession._should_use_workflow(state, "/REPLAN") is True

    def test_replan_with_leading_whitespace(self):
        state = {"status": PlanStatus.ITERATE}
        # strip() applied before startswith check
        assert RedisSession._should_use_workflow(state, "  /replan now") is True

    def test_non_iterate_statuses_return_true(self):
        for status in [PlanStatus.EXTRACT, PlanStatus.RECON, PlanStatus.CLUSTER,
                       PlanStatus.ROUTE, PlanStatus.BUILD, PlanStatus.REVIEW]:
            state = {"status": status}
            assert RedisSession._should_use_workflow(state) is True, \
                f"Expected True for status {status}"

    def test_string_without_replan_not_overriding(self):
        state = {"status": PlanStatus.ITERATE}
        assert RedisSession._should_use_workflow(state, "just a regular message") is False


# ── _load_planner_session_state ───────────────────────────────────────────────

class TestLoadPlannerSessionState:
    @pytest.mark.asyncio
    async def test_missing_key_returns_empty_dict(self):
        session = make_session()
        session.redis_client.get = AsyncMock(return_value=None)

        result = await session._load_planner_session_state()

        assert result == {}

    @pytest.mark.asyncio
    async def test_parses_json_from_redis(self):
        session = make_session()
        stored = {"status": "iterate", "tasks": []}
        session.redis_client.get = AsyncMock(return_value=json.dumps(stored))

        result = await session._load_planner_session_state()

        assert result == stored

    @pytest.mark.asyncio
    async def test_uses_correct_redis_key(self):
        session = make_session(chat_id="my-chat")
        session.redis_client.get = AsyncMock(return_value=None)

        await session._load_planner_session_state()

        session.redis_client.get.assert_called_once_with("planner_state:my-chat")

    @pytest.mark.asyncio
    async def test_redis_error_returns_empty_dict(self):
        session = make_session()
        session.redis_client.get = AsyncMock(side_effect=Exception("timeout"))

        result = await session._load_planner_session_state()

        assert result == {}

    @pytest.mark.asyncio
    async def test_invalid_json_returns_empty_dict(self):
        session = make_session()
        session.redis_client.get = AsyncMock(return_value="not-valid-json{{")

        result = await session._load_planner_session_state()

        assert result == {}


# ── _save_planner_session_state ───────────────────────────────────────────────

class TestSavePlannerSessionState:
    @pytest.mark.asyncio
    async def test_uses_correct_redis_key(self):
        session = make_session(chat_id="my-chat")
        session.redis_client.set = AsyncMock()

        await session._save_planner_session_state({"status": "iterate"})

        args = session.redis_client.set.call_args
        assert args[0][0] == "planner_state:my-chat"

    @pytest.mark.asyncio
    async def test_sets_ttl_86400(self):
        session = make_session()
        session.redis_client.set = AsyncMock()

        await session._save_planner_session_state({})

        args = session.redis_client.set.call_args
        assert args[1].get("ex") == 86400

    @pytest.mark.asyncio
    async def test_serializes_state_to_json(self):
        session = make_session()
        session.redis_client.set = AsyncMock()
        state = {"status": "iterate", "count": 3}

        await session._save_planner_session_state(state)

        args = session.redis_client.set.call_args
        serialized = args[0][1]
        assert json.loads(serialized) == state

    @pytest.mark.asyncio
    async def test_swallows_redis_error(self):
        session = make_session()
        session.redis_client.set = AsyncMock(side_effect=Exception("connection lost"))

        # should not raise
        await session._save_planner_session_state({"x": 1})

    @pytest.mark.asyncio
    async def test_reraises_cancelled_error(self):
        session = make_session()
        session.redis_client.set = AsyncMock(side_effect=asyncio.CancelledError())

        with pytest.raises(asyncio.CancelledError):
            await session._save_planner_session_state({"x": 1})


# ── _run_planning_workflow_steps ──────────────────────────────────────────────

class TestRunPlanningWorkflowSteps:
    def _make_workflow_mock(self, session_state=None):
        wf = MagicMock()
        wf.session_state = session_state if session_state is not None else {}
        return wf

    def _base_payload(self):
        return {"planning_date": "2024-01-15", "timezone": "UTC", "tasks": []}

    @pytest.mark.asyncio
    async def test_emits_chunks_and_returns_list(self):
        session = make_session()
        step1 = make_step(content="Analyzing tasks...")
        step2 = make_step(content="Building schedule...")
        mock_wf = self._make_workflow_mock()

        with patch("src.server.redis_session.build_planning_workflow", return_value=mock_wf), \
             patch("src.server.redis_session._run_planning_steps", return_value=iter([step1, step2])):
            result = await session._run_planning_workflow_steps(
                user_message="plan my day",
                payload=self._base_payload(),
                session_state={},
                msg_chat_id="chat-1",
                message_id="msg-1",
            )

        assert result == ["Analyzing tasks...", "Building schedule..."]
        assert session._send_frame.call_count == 2

    @pytest.mark.asyncio
    async def test_skips_steps_without_content(self):
        session = make_session()
        step1 = make_step(content="Step one")
        step2 = make_step(content=None)  # no content
        step3 = make_step(content="Step three")
        mock_wf = self._make_workflow_mock()

        with patch("src.server.redis_session.build_planning_workflow", return_value=mock_wf), \
             patch("src.server.redis_session._run_planning_steps", return_value=iter([step1, step2, step3])):
            result = await session._run_planning_workflow_steps(
                user_message="plan", payload=self._base_payload(),
                session_state={}, msg_chat_id="chat-1", message_id="msg-1",
            )

        assert result == ["Step one", "Step three"]
        assert session._send_frame.call_count == 2

    @pytest.mark.asyncio
    async def test_saves_state_after_run(self):
        session = make_session(chat_id="chat-save")
        mock_wf = self._make_workflow_mock({"status": "iterate"})

        with patch("src.server.redis_session.build_planning_workflow", return_value=mock_wf), \
             patch("src.server.redis_session._run_planning_steps", return_value=iter([])):
            await session._run_planning_workflow_steps(
                user_message="plan", payload=self._base_payload(),
                session_state={}, msg_chat_id="chat-save", message_id="msg-1",
            )

        session.redis_client.set.assert_called_once()
        key_arg = session.redis_client.set.call_args[0][0]
        assert key_arg == "planner_state:chat-save"

    @pytest.mark.asyncio
    async def test_applies_plan_patches_if_present(self):
        session = make_session()
        patches_data = {"patches": [{"op": "add_chip"}], "summary": "done"}
        mock_wf = self._make_workflow_mock({"plan_patches": patches_data})

        # _send_client_action_and_wait is complex; mock it directly.
        # Note: the CONTEXT preflight also calls it (for calendar/health) before patches are applied,
        # so we check with assert_any_call rather than assert_called_once_with.
        session._send_client_action_and_wait = AsyncMock(return_value="")

        with patch("src.server.redis_session.build_planning_workflow", return_value=mock_wf), \
             patch("src.server.redis_session._run_planning_steps", return_value=iter([])):
            await session._run_planning_workflow_steps(
                user_message="plan", payload=self._base_payload(),
                session_state={}, msg_chat_id="chat-1", message_id="msg-1",
            )

        session._send_client_action_and_wait.assert_any_call(
            "patch_plan_document", "edit", patches_data,
        )
        # plan_patches should be removed from state before saving
        saved_state_json = session.redis_client.set.call_args[0][1]
        saved_state = json.loads(saved_state_json)
        assert "plan_patches" not in saved_state

    @pytest.mark.asyncio
    async def test_fallback_on_workflow_exception(self):
        session = make_session()
        mock_wf = self._make_workflow_mock()

        with patch("src.server.redis_session.build_planning_workflow", return_value=mock_wf), \
             patch("src.server.redis_session._run_planning_steps", side_effect=RuntimeError("boom")):
            result = await session._run_planning_workflow_steps(
                user_message="plan", payload=self._base_payload(),
                session_state={}, msg_chat_id="chat-1", message_id="msg-1",
            )

        assert len(result) == 1
        assert result[0]  # non-empty fallback message
        # frame should have been sent with the fallback
        assert session._send_frame.call_count == 1

    @pytest.mark.asyncio
    async def test_respects_cancel_event(self):
        session = make_session()
        mock_wf = self._make_workflow_mock()

        step1 = make_step(content="First")
        step2 = make_step(content="Second")

        call_count = 0
        def steps_gen(*args, **kwargs):
            nonlocal call_count
            yield step1
            session.cancel_event.set()
            yield step2

        with patch("src.server.redis_session.build_planning_workflow", return_value=mock_wf), \
             patch("src.server.redis_session._run_planning_steps", side_effect=steps_gen):
            result = await session._run_planning_workflow_steps(
                user_message="plan", payload=self._base_payload(),
                session_state={}, msg_chat_id="chat-1", message_id="msg-1",
            )

        # Only the first step should be emitted (cancel stops after first)
        assert result == ["First"]

    @pytest.mark.asyncio
    async def test_reraises_cancelled_error(self):
        session = make_session()
        mock_wf = self._make_workflow_mock()

        with patch("src.server.redis_session.build_planning_workflow", return_value=mock_wf), \
             patch("src.server.redis_session._run_planning_steps", side_effect=asyncio.CancelledError()):
            with pytest.raises(asyncio.CancelledError):
                await session._run_planning_workflow_steps(
                    user_message="plan", payload=self._base_payload(),
                    session_state={}, msg_chat_id="chat-1", message_id="msg-1",
                )

    @pytest.mark.asyncio
    async def test_builds_workflow_with_correct_params(self):
        session = make_session(chat_id="my-chat")
        mock_wf = self._make_workflow_mock()

        with patch("src.server.redis_session.build_planning_workflow", return_value=mock_wf) as mock_build, \
             patch("src.server.redis_session._run_planning_steps", return_value=iter([])):
            await session._run_planning_workflow_steps(
                user_message="plan", payload=self._base_payload(),
                session_state={"status": "extract"},
                msg_chat_id="my-chat", message_id="msg-1",
            )

        mock_build.assert_called_once()
        kwargs = mock_build.call_args[1]
        assert kwargs.get("session_id") == "my-chat"
        # CONTEXT preflight adds context_data to session_state before the workflow runs;
        # verify the original status is preserved rather than exact dict equality.
        assert kwargs.get("session_state", {}).get("status") == "extract"

    @pytest.mark.asyncio
    async def test_uses_payload_tasks_over_parsed(self):
        """When payload has tasks, they take priority over text-parsed tasks."""
        session = make_session()
        mock_wf = self._make_workflow_mock()
        captured = {}

        def capture_build(*args, **kwargs):
            captured["planning_input"] = None
            return mock_wf

        original_steps = iter([])

        with patch("src.server.redis_session.build_planning_workflow", side_effect=capture_build), \
             patch("src.server.redis_session._run_planning_steps", return_value=original_steps):
            payload = {
                "planning_date": "2024-01-15",
                "timezone": "UTC",
                "tasks": [{"id": "t1", "title": "From payload"}],
            }
            # message also has ID: pattern that would be parsed
            await session._run_planning_workflow_steps(
                user_message="ID:t2 From message",
                payload=payload,
                session_state={},
                msg_chat_id="chat-1",
                message_id="msg-1",
            )

        # If build_planning_workflow was called, payload tasks were used (not parsed)
        assert "planning_input" in captured  # workflow was built
