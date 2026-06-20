import asyncio
import base64
import json
import logging
import os
import re
import uuid
import time
import httpx
from collections.abc import AsyncIterator
from datetime import datetime, timezone, timedelta
from typing import Any

from redis.exceptions import ConnectionError as RedisConnectionError
from agno.media import Image
from agno.memory.manager import MemoryManager
from agno.models.message import Message
from src.agents.factory import AgentFactory
from src.agents.nomi import NomiAgent, build_learning_machine
from src.storage.backend import PayloadBackend, StorageBackend
from src.storage.factory import create_storage_backend
from src.constants import Redis as RedisConstants
from src.server import stub_brain
from src.server.models import Frame, Op, Kind
from src.server.redis_client import make_redis_client
from src.server.utils import (
    make_meta,
    make_error,
    make_done,
    make_data,
    make_generation_status,
    make_signal,
)
from src.tools.models import ToolSpec
from src.workflows.models import PlanStatus
from src.workflows.planning import build_planning_workflow
from src.workflows.planning import PlanningInput as WorkflowPlanningInput
from src.workflows.planning import _planning_steps as _run_planning_steps
from src.workflows.planning import STAGE_STATUS_TEXT, parse_tasks_from_message

logger = logging.getLogger(__name__)

# Base URL of the Go API for server-to-server calls (pending-action outbox).
_GO_API_URL = os.getenv("GO_API_URL", "http://localhost:8080").rstrip("/")

# Method-name prefixes treated as read-only. Deferred reads expire quickly (a
# late answer to a question is useless); writes are kept longer.
_READ_METHOD_PREFIXES = ("get", "list", "search", "read", "find", "fetch")
_DEFERRED_READ_TTL_SECONDS = 5 * 60
_DEFERRED_WRITE_TTL_SECONDS = 24 * 60 * 60


# --- Deferred, debounced learning (profile + entity + memory extraction) ------
# Extraction is moved OFF the reply path. The reply agent only READS learnings
# into its prompt (see nomi.build_learning_machine(extract=False)); the extraction
# LLM calls used to run inline during the turn and contended with reply
# generation. Instead, after each turn we accumulate the (user, assistant)
# messages per chat and (re)arm a short idle timer; when the user pauses, ONE
# background pass extracts profile + entities + memories. This never overlaps an
# active reply and batches a burst of turns into a single extraction.
_LEARN_DEBOUNCE_MS = int(os.getenv("VOICE_LEARN_DEBOUNCE_MS", "6000"))
_learn_state: dict[str, dict[str, Any]] = {}
_learn_bg_tasks: set[asyncio.Task] = set()


def _learn_entry(chat_id: str) -> dict[str, Any]:
    entry = _learn_state.get(chat_id)
    if entry is None:
        entry = {"messages": [], "timer": None, "lock": asyncio.Lock(), "ctx": None}
        _learn_state[chat_id] = entry
    return entry


def _dedup_memories(db: Any, user_id: str) -> None:
    """Remove exact-duplicate user memories created by the extraction pass."""
    try:
        all_memories = db.get_user_memories(user_id=user_id)
        if not all_memories or len(all_memories) < 2:
            return
        seen: set[str] = set()
        to_delete: list[str] = []
        for mem in all_memories:
            key = re.sub(r"\s+", " ", (mem.memory or "").lower().strip())
            if key in seen:
                if mem.memory_id:
                    to_delete.append(mem.memory_id)
            else:
                seen.add(key)
        if to_delete:
            db.delete_user_memories(to_delete, user_id=user_id)
    except Exception as e:
        logger.warning("[RedisSession] Memory dedup failed (non-fatal): %s", e)


async def _run_deferred_learning(chat_id: str) -> None:
    """Extract profile + entities + memories for an idle chat's accumulated burst."""
    entry = _learn_state.get(chat_id)
    if not entry:
        return
    async with entry["lock"]:
        messages = entry.get("messages") or []
        ctx = entry.get("ctx")
        if not messages or not ctx:
            return
        # Consume the accumulated burst so a later turn starts fresh.
        entry["messages"] = []
        db = ctx.get("db")
        user_id = ctx.get("user_id")
        agent_factory = ctx.get("agent_factory")
        if db is None or not user_id or agent_factory is None:
            return
        try:
            model = agent_factory.build_model(
                ctx.get("model_name") or "gemini-2.5-flash-lite",
                thinking="off",
            )
            lm = build_learning_machine(model, db, user_id, extract=True)
            await lm.aprocess(
                messages=list(messages),
                user_id=user_id,
                session_id=ctx.get("session_id"),
            )
            mm = MemoryManager(model=model, db=db)
            await mm.acreate_user_memories(messages=list(messages), user_id=user_id)
            _dedup_memories(db, user_id)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning(
                "[RedisSession] Deferred learning failed (non-fatal): %s", e
            )


async def _deferred_learning_timer(chat_id: str) -> None:
    try:
        await asyncio.sleep(_LEARN_DEBOUNCE_MS / 1000)
    except asyncio.CancelledError:
        return  # superseded by a newer turn — that turn re-armed the timer
    await _run_deferred_learning(chat_id)


class RedisSession:
    def __init__(
        self,
        agent_factory: AgentFactory,
        session_id: str,
        user_id: str | None = None,
        chat_id: str | None = None,
        redis_worker: Any = None,
        go_ws: Any = None,
    ):
        self.agent_factory = agent_factory
        self.session_id = session_id
        self.user_id = user_id
        self.chat_id = chat_id or session_id
        self.redis_worker = redis_worker
        self._go_ws = go_ws  # GoWSClient instance; None → Redis-only path

        self.redis_client = None
        self.agent: Any | None = None
        self.tools_specs: list[ToolSpec] = []
        self.active_agents: set[str] = set()

        # State (similar to WS session)
        self.current_model_name: str | None = None
        self.current_thinking: str = "off"
        self.command_desc: dict | None = None
        self.agent_type: str | None = None

        # Initialize Redis for sending responses
        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        self.redis_client = make_redis_client(redis_url)
        self.next_id = 0
        self.cancel_event = asyncio.Event()

        # History storage
        self.chat_history: list[dict[str, Any]] = []

        # Single chat mode state
        self.single_chat_mode: bool = False  # Set from session state payload
        self.byok: dict[str, str] = {}  # BYOK LLM keys; set from payload
        self.byok_default: str = ""
        self._model_context_limit: int | None = None  # Loaded lazily
        self._model_supports_vision_cache: bool | None = None  # Loaded lazily

        # Context items (emails, documents, etc.)
        self.context_items: list[dict[str, Any]] = []

        # Project context (set from payload in handle_user_message); carries the
        # project's id/name/description when the chat belongs to a project.
        self._project_context: dict[str, Any] | None = None

        # Plugin delivery context (set from payload in handle_user_message)
        self._delivery_source: str | None = None
        self._delivery_context: dict[str, Any] = {}

        # Proactive event meta (set per-request when source=proactive); carried
        # onto the response meta frame so the client renders badge + deep-link.
        self._proactive_meta: dict[str, Any] | None = None

        # Storage backend (set per-request from agent_storage_mode flag)
        self.storage_backend: StorageBackend = PayloadBackend(chat_history=[])

        # Per-session client tool result handling
        self.pubsub: Any | None = None
        self.pending_client_tool_results: dict[str, asyncio.Future] = {}
        self._result_listener_task: asyncio.Task | None = None

        # Accumulated tool results for agent context
        self._accumulated_tool_results: list[dict[str, Any]] = []

    async def _start_result_listener(self):
        """Start listening for client tool results on per-session channel."""
        if self.pubsub is not None:
            return  # Already started

        try:
            # Create a new pubsub for this session
            self.pubsub = self.redis_client.pubsub()

            # Subscribe to per-session channel
            channel = RedisConstants.CHANNEL_CLIENT_TOOL_RESULT.format(self.session_id)
            await self.pubsub.subscribe(channel)


            # Start background listener task immediately
            # No need to wait for subscription confirmation - Redis subscription is reliable
            self._result_listener_task = asyncio.create_task(self._listen_for_results())

        except Exception as e:
            logger.error(
                "[RedisSession] Failed to start result listener: %s", e, exc_info=True
            )

    async def _listen_for_results(self):
        """Background task to listen for client tool results."""
        if not self.pubsub:
            return

        try:
            async for message in self.pubsub.listen():
                if message["type"] != "message":
                    continue

                try:
                    data = message.get("data")
                    if isinstance(data, bytes):
                        data = data.decode("utf-8")

                    payload = json.loads(data) if isinstance(data, str) else data
                    call_id = payload.get("call_id")
                    result = payload.get("result", "")

                    if call_id and call_id in self.pending_client_tool_results:
                        future = self.pending_client_tool_results.pop(call_id)
                        if not future.done():
                            future.set_result(result)
                except Exception as e:
                    logger.warning(
                        "[RedisSession] Failed to process client tool result: %s", e
                    )

        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("[RedisSession] Result listener error: %s", e, exc_info=True)

    async def _cleanup_result_listener(self):
        """Clean up the result listener and pubsub connection."""
        if self._result_listener_task:
            self._result_listener_task.cancel()
            try:
                await self._result_listener_task
            except asyncio.CancelledError:
                pass
            self._result_listener_task = None

        if self.pubsub:
            try:
                await self.pubsub.unsubscribe()
                await self.pubsub.close()
            except Exception as e:
                logger.warning("[RedisSession] Failed to close pubsub: %s", e)
            self.pubsub = None

    async def _broadcast_system_status(self):
        count = len(self.active_agents)
        # Construct payload
        payload = {
            "type": "system_status",
            "active_agents_count": count,
            "active_agents_list": list(self.active_agents),
        }

        frame = Frame(
            id=self.next_id,
            ts=datetime.now(timezone.utc),
            kind=Kind.SIGNAL,
            op=Op.SIGNAL,
            chat_id=self.chat_id,
            payload=payload,
        )

        await self._send_frame(frame)

    async def _reconnect_redis(self):
        """Reconnect to Redis by creating a fresh client."""
        try:
            if self.redis_client:
                try:
                    await self.redis_client.aclose()
                except Exception:
                    pass
            redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
            self.redis_client = make_redis_client(redis_url)
        except Exception as e:
            logger.error("[RedisSession] Failed to reconnect to Redis: %s", e)
            self.redis_client = None

    async def _send_frame(self, frame: Frame) -> int:
        # Direct WS path: deliver to Go without Redis hop when worker WS is available.
        if self._go_ws is not None and self._go_ws.is_connected:
            try:
                await self._go_ws.send_frame(frame)
                self.next_id = frame.id + 1
                return self.next_id
            except Exception as e:
                logger.warning("[RedisSession] GoWS send failed, falling back to Redis: %s", e)

        # Redis fallback (always available)
        data = frame.marshal()
        target_id = self.user_id or self.session_id
        channel = f"chat:user:{target_id}"
        payload_json = json.dumps(data)

        if self.redis_client:
            try:
                await self.redis_client.publish(channel, payload_json)
            except RedisConnectionError as e:
                logger.warning(
                    "[RedisSession] Publish failed (ConnectionError), reconnecting: %s",
                    e,
                )
                await self._reconnect_redis()
                if self.redis_client:
                    try:
                        await self.redis_client.publish(channel, payload_json)
                    except Exception as e2:
                        logger.error(
                            "[RedisSession] Publish failed after reconnect: %s",
                            e2,
                            exc_info=True,
                        )
            except Exception as e:
                logger.error(
                    "[RedisSession] Publish failed: %s",
                    e,
                    exc_info=True,
                    extra={
                        "channel": channel,
                        "frame_op": frame.op,
                        "chat_id": self.chat_id,
                        "user_id": self.user_id,
                    },
                )

        self.next_id = frame.id + 1
        return self.next_id

    async def _spawn_background_task(self, goal: str) -> str:
        """Launch an autonomous background task and return its id immediately.

        Backs the start_background_task tool. Publishes a TASK_START frame onto
        chat:request:{chat_id}; the worker picks it up and runs it detached from
        this turn (see RedisWorker._start_task_run).
        """
        from src.server.models import Op
        from src.server.utils import make_signal

        task_id = str(uuid.uuid4())
        payload = {
            "user_id": self.user_id,
            "chat_id": self.chat_id,
            "goal": goal,
            "task_id": task_id,
            "model": self.current_model_name,
            "agent_type": "nomi",
        }
        frame = make_signal(0, Op.TASK_START, self.chat_id, payload)
        if self.redis_client:
            await self.redis_client.publish(
                f"chat:request:{self.chat_id}", json.dumps(frame.marshal())
            )
        return task_id

    def _make_sync_delegation_emitter(self, task_id: str, goal: str, agent: str):
        """Build a lifecycle emitter that persists a synchronous delegation as a
        hidden AgentTask row.

        Backs DelegationTools' synchronous path: the row exists for audit + chat
        linkage but is filtered out of the Tasks screen (background=False) and the
        live UI (live=False), so it never surfaces as a visible task.
        """
        from src.server.task_runner import TaskEventEmitter

        return TaskEventEmitter(
            self.redis_client,
            task_id,
            self.user_id or "",
            self.chat_id,
            goal,
            live=False,
            background=False,
            agent=agent,
        )

    async def _safe_deliver(self, delivery_handler, full_text: str) -> None:
        """Deliver a reply to an external plugin channel without letting a plugin
        failure crash the streaming response. Re-raises CancelledError."""
        try:
            await delivery_handler.deliver(full_text, self._delivery_context)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(
                "[RedisSession] Delivery handler failed for source=%s: %s",
                self._delivery_source,
                e,
                exc_info=True,
            )

    @staticmethod
    def _should_use_workflow(session_state: dict, user_message: str = "") -> bool:
        """Return True if the planner should use the multi-stage workflow.

        Returns False only when the plan is already built (ITERATE status),
        where the lightweight planner agent handles incremental edits.
        Returns True for /replan command to force full workflow restart.
        """
        # Check for /replan command - force workflow restart
        if user_message.strip().lower().startswith("/replan"):
            return True
        status = session_state.get("status", "")
        return status != PlanStatus.ITERATE

    async def _load_planner_session_state(self) -> dict:
        """Load persisted workflow session_state for this chat from Redis."""
        try:
            key = f"planner_state:{self.chat_id}"
            raw = await self.redis_client.get(key)
            if raw:
                return json.loads(raw)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("[PlannerSession] Failed to load state: %s", exc)
        return {}

    async def _save_planner_session_state(self, state: dict) -> None:
        """Persist workflow session_state to Redis (TTL: 24h)."""
        try:
            key = f"planner_state:{self.chat_id}"
            await self.redis_client.set(key, json.dumps(state, default=str), ex=86400)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("[PlannerSession] Failed to save state: %s", exc)

    async def _fetch_calendar_events_for_plan(self, planning_date: str) -> list[dict]:
        """Fetch iOS Calendar events for the planning date via client_action.

        Returns empty list on any error (graceful degradation).
        """
        try:
            start = f"{planning_date}T00:00:00"
            end = f"{planning_date}T23:59:59"
            raw = await self._send_client_action_and_wait(
                "ios_calendar",
                "get_events",
                {"start_date": start, "end_date": end, "limit": 30},
            )
            match = re.search(r"```json\s*(\[.*?\])\s*```", raw, re.DOTALL)
            return json.loads(match.group(1)) if match else []
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("[PlannerContext] Calendar fetch failed (non-fatal): %s", exc)
            return []

    async def _fetch_health_summary_for_plan(self, yesterday_date: str) -> dict:
        """Fetch iOS Health daily summary for yesterday via client_action.

        Returns empty dict on any error (graceful degradation).
        """
        try:
            raw = await self._send_client_action_and_wait(
                "ios_health",
                "get_daily_summary",
                {"date": yesterday_date},
            )
            result: dict = {}
            dm = re.search(r"Duration:\s*([\d.]+)\s*hours", raw)
            qm = re.search(r"Quality:\s*(\w+)", raw)
            sm = re.search(r"Steps:\s*(\d+)", raw)
            if dm or qm:
                result["sleep"] = {}
                if dm:
                    result["sleep"]["duration"] = float(dm.group(1))
                if qm:
                    result["sleep"]["quality"] = qm.group(1).lower()
            if sm:
                result["activity"] = {"steps": int(sm.group(1))}
            return result
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("[PlannerContext] Health fetch failed (non-fatal): %s", exc)
            return {}

    async def _run_planning_workflow_steps(
        self,
        user_message: str,
        payload: dict,
        session_state: dict,
        msg_chat_id: str,
        message_id: str,
    ) -> list[str]:
        """Run the planning workflow, stream StepOutput content as text frames.

        Returns the list of text chunks emitted (for delivery handler).
        Applies plan_patches to the mobile client if BUILD stage completed.
        """
        from agno.workflow.types import WorkflowExecutionInput
        from src.workflows.models import PlanTask

        # Build PlanningInput from payload
        raw_tasks = payload.get("tasks", [])

        # If no tasks in payload, try to parse from message text
        if not raw_tasks and user_message:
            raw_tasks = parse_tasks_from_message(user_message)

        tasks = [PlanTask(**t) if isinstance(t, dict) else t for t in raw_tasks]
        planning_input = WorkflowPlanningInput(
            user_message=user_message,
            chat_id=self.chat_id,
            user_id=self.user_id or "",
            planning_date=payload.get("planning_date", ""),
            tasks=tasks,
            session_state=session_state,
            timezone=payload.get("timezone", "UTC"),
        )

        # Inject user_location into session_state so RECON can geocode it as the
        # user's starting point. Only set if not already persisted from a previous run.
        user_location = payload.get("user_location") or None
        if user_location and "user_location" not in session_state:
            session_state["user_location"] = user_location

        # CONTEXT preflight: fetch calendar events and (conditionally) health summary
        # before the sync workflow generator starts. Only runs on the first invocation.
        planning_date = payload.get("planning_date", "")
        planning_level = (self.command_desc or {}).get("level", "standard")
        current_status = session_state.get("status", PlanStatus.CONTEXT)
        if current_status == PlanStatus.CONTEXT or "context_data" not in session_state:
            from datetime import date as _date, timedelta
            try:
                plan_dt = _date.fromisoformat(planning_date) if planning_date else _date.today()
            except ValueError:
                plan_dt = _date.today()
            yesterday = (plan_dt - timedelta(days=1)).isoformat()

            if planning_level == "quick":
                cal_events = await self._fetch_calendar_events_for_plan(planning_date)
                if isinstance(cal_events, BaseException):
                    cal_events = []
                health_summary: dict = {}
            else:
                cal_events, health_summary = await asyncio.gather(
                    self._fetch_calendar_events_for_plan(planning_date),
                    self._fetch_health_summary_for_plan(yesterday),
                    return_exceptions=True,
                )
                if isinstance(cal_events, BaseException):
                    cal_events = []
                if isinstance(health_summary, BaseException):
                    health_summary = {}

            session_state["context_data"] = {
                "calendar_events": cal_events,
                "health_summary": health_summary,
            }
            session_state["planning_level"] = planning_level
            logger.info(
                "[PlannerContext] level=%s, loaded %d calendar events, health_summary keys=%s",
                planning_level,
                len(cal_events),
                list(health_summary.keys()),
            )

        workflow = build_planning_workflow(
            session_id=self.chat_id,
            session_state=session_state,
        )

        execution_input = WorkflowExecutionInput(
            input=user_message,
            additional_data={"planning_input": planning_input},
        )

        emitted: list[str] = []
        idx = 0
        logger.info(
            "[PlannerWorkflow] Starting workflow with status=%s",
            session_state.get("status"),
        )
        try:
            # _planning_steps is a sync generator — iterate directly
            for step in _run_planning_steps(workflow, execution_input):
                step_name = step.step_name if hasattr(step, "step_name") else "unknown"
                logger.info("[PlannerWorkflow] Step yielded: %s", step_name)
                if self.cancel_event.is_set():
                    break
                chunk = step.content if hasattr(step, "content") else None
                if not chunk:
                    continue
                chunk = str(chunk)

                if step_name == "clarify":
                    options = (workflow.session_state or {}).get(
                        "_current_clarifying_options", []
                    )
                    call_id = str(uuid.uuid4())
                    await self._send_frame(
                        make_data(
                            self.next_id,
                            Op.MESSAGE,
                            msg_chat_id,
                            {
                                "type": "client_action",
                                "call_id": call_id,
                                "tool": "ask_user",
                                "method": "ask",
                                "params": {
                                    "question": chunk,
                                    "options": options,
                                    "allow_custom": True,
                                },
                            },
                        )
                    )
                    logger.info(
                        "[PlannerWorkflow] Sent ask_user client_action call_id=%s opts=%s",
                        call_id,
                        options,
                    )
                else:
                    emitted.append(chunk)
                    await self._send_frame(
                        make_data(
                            self.next_id,
                            Op.MESSAGE,
                            msg_chat_id,
                            {
                                "ix": idx,
                                "eof": False,
                                "message": chunk,
                                "message_id": message_id,
                            },
                        )
                    )
                    idx += 1
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(
                "[PlannerWorkflow] Error running workflow: %s", exc, exc_info=True
            )
            fallback = "An error occurred during planning. Please try again."
            emitted.append(fallback)
            await self._send_frame(
                make_data(
                    self.next_id,
                    Op.MESSAGE,
                    msg_chat_id,
                    {
                        "ix": idx,
                        "eof": False,
                        "message": fallback,
                        "message_id": message_id,
                    },
                )
            )

        # Apply plan_patches if BUILD stage generated them
        new_state = workflow.session_state or {}
        if "plan_patches" in new_state:
            patch_data = new_state.pop("plan_patches")
            try:
                await self._send_client_action_and_wait(
                    "patch_plan_document",
                    "edit",
                    patch_data,
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error("[PlannerWorkflow] Failed to apply plan patches: %s", exc)

        # Persist updated session_state
        await self._save_planner_session_state(new_state)

        return emitted

    async def _enqueue_pending_action(
        self, call_id: str, plugin: str, method: str, params: dict[str, Any]
    ) -> bool:
        """Persist a client action to the server-side outbox and trigger a silent
        wake push (handled by the Go endpoint). Best-effort: failures are logged
        and do not abort the live attempt."""
        if not self.user_id:
            return False
        try:
            is_read = method.lower().startswith(_READ_METHOD_PREFIXES)
            ttl = _DEFERRED_READ_TTL_SECONDS if is_read else _DEFERRED_WRITE_TTL_SECONDS
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl)
            body: dict[str, Any] = {
                "user_id": str(self.user_id),
                "source": self._delivery_source or "",
                "delivery_context": self._delivery_context or {},
                "session_id": self.session_id,
                "call_id": call_id,
                "tool": plugin,
                "method": method,
                "params": params,
                "expires_at": expires_at.isoformat(),
            }
            integration_id = params.get("integration_id")
            if integration_id:
                body["integration_id"] = str(integration_id)
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{_GO_API_URL}/internal/pending-actions/enqueue", json=body
                )
                resp.raise_for_status()
            logger.info("[ClientTool] Enqueued pending action call_id=%s", call_id)
            return True
        except Exception as exc:
            logger.warning(
                "[ClientTool] Failed to enqueue pending action call_id=%s: %s",
                call_id,
                exc,
            )
            return False

    async def _finalize_pending_action(
        self, call_id: str, status: str = "done", result: str = ""
    ) -> None:
        """Mark a queued action as resolved so the device won't re-drain it."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(
                    f"{_GO_API_URL}/internal/pending-actions/finalize",
                    json={"call_id": call_id, "status": status, "result": result},
                )
        except Exception as exc:
            logger.warning(
                "[ClientTool] Failed to finalize pending action call_id=%s: %s",
                call_id,
                exc,
            )

    async def _send_client_action_and_wait(
        self, plugin: str, method: str, params: dict[str, Any]
    ) -> str:
        """Send client_action to the device and wait for tool result with exponential backoff retry."""
        start_time = time.time()

        logger.info(
            "[ClientTool] Sending: plugin=%s method=%s params=%s",
            plugin,
            method,
            params,
        )

        # Ensure result listener is started
        if not self.pubsub:
            await self._start_result_listener()

        call_id = str(uuid.uuid4())
        loop = asyncio.get_event_loop()
        future = loop.create_future()
        self.pending_client_tool_results[call_id] = future

        logger.info("[ClientTool] Registered call_id=%s", call_id)

        try:
            # Store idempotency key in Redis (expires in 60s)
            idempotency_key = f"client_action:{call_id}"
            idempotency_data = {
                "plugin": plugin,
                "method": method,
                "params": params,
                "sent_at": datetime.now(timezone.utc).isoformat(),
                "session_id": self.session_id,
            }
            if self.redis_client:
                await self.redis_client.setex(
                    idempotency_key, 60, json.dumps(idempotency_data)
                )

            # Send client_action frame
            # Extract integration_id from params if present (for multi-account support)
            # Use .get() to avoid mutating the caller's dict.
            integration_id = params.get("integration_id")
            payload_data = {
                "type": "client_action",
                "call_id": call_id,
                "tool": plugin,
                "method": method,
                "params": params,
            }
            if integration_id:
                payload_data["integration_id"] = integration_id

            # Server-side flow (e.g. Telegram): the device may be offline. Persist
            # the action to the outbox and trigger a silent wake push BEFORE
            # sending, so a backgrounded/terminated app can come online and drain
            # it even if it never receives this live frame.
            if self._delivery_source:
                await self._enqueue_pending_action(call_id, plugin, method, params)

            await self._send_frame(
                make_data(self.next_id, Op.MESSAGE, self.chat_id, payload_data)
            )

            logger.info("[ClientTool] Sent client_action for call_id=%s", call_id)

            # Deferred path: if this is a server-side flow, wait only a short
            # window for a live device. If it doesn't answer, the action stays
            # queued (drained on next app launch / background wake) and we return
            # an optimistic sentinel so the user is told it will run shortly.
            if self._delivery_source:
                DEFERRED_TIMEOUT = 30.0
                try:
                    result = await asyncio.wait_for(future, timeout=DEFERRED_TIMEOUT)
                    if result is None:
                        return "Error: Client returned no result (None)."
                    await self._finalize_pending_action(call_id, "done", str(result))
                    if self.redis_client:
                        await self.redis_client.delete(idempotency_key)
                    return str(result)
                except asyncio.TimeoutError:
                    logger.info(
                        "[ClientTool] Deferred: device offline, action queued call_id=%s",
                        call_id,
                    )
                    return (
                        "The user's device is currently offline, so this action "
                        "could not be performed immediately. It has been queued and "
                        "will run automatically the next time their app comes "
                        "online. Let the user know it will be completed shortly."
                    )

            # Exponential backoff retry
            MAX_RETRIES = 3
            BASE_TIMEOUT = 30.0  # seconds
            HEALTHKIT_TIMEOUT = 90.0  # Increased timeout for HealthKit operations (can be slow for large datasets)

            for attempt in range(MAX_RETRIES):
                # Use longer timeout for HealthKit operations
                timeout = (
                    HEALTHKIT_TIMEOUT
                    if plugin.startswith("ios_")
                    else (BASE_TIMEOUT * (1.5**attempt))
                )
                try:
                    logger.info(
                        "[ClientTool] Waiting for result (attempt %d/%d, timeout=%.1fs, call_id=%s)",
                        attempt + 1,
                        MAX_RETRIES,
                        timeout,
                        call_id,
                    )
                    result = await asyncio.wait_for(future, timeout=timeout)

                    if result is None:
                        logger.warning(
                            "[ClientTool] Result is None for call_id=%s", call_id
                        )
                        return "Error: Client returned no result (None)."

                    # Calculate latency
                    latency_ms = int((time.time() - start_time) * 1000)

                    logger.info(
                        "[ClientTool] Result received: call_id=%s latency=%dms",
                        call_id,
                        latency_ms,
                    )

                    # Delete idempotency key on success
                    if self.redis_client:
                        await self.redis_client.delete(idempotency_key)

                    return str(result)

                except asyncio.TimeoutError:
                    if attempt < MAX_RETRIES - 1:
                        logger.warning(
                            "[ClientTool] Timeout attempt %d/%d for %s.%s (call_id=%s), retrying...",
                            attempt + 1,
                            MAX_RETRIES,
                            plugin,
                            method,
                            call_id,
                        )
                        continue
                    else:
                        total_time = time.time() - start_time
                        logger.error(
                            "[ClientTool] Timeout: call_id=%s after %.1fs (%d attempts)",
                            call_id,
                            total_time,
                            MAX_RETRIES,
                        )
                        return (
                            "Client tool execution timed out (device may be offline)."
                        )

            # Fallback if we somehow exit the loop without returning
            return "Client tool execution failed (unexpected loop exit)."

        except Exception as e:
            logger.error(
                "[ClientTool] Error: plugin=%s method=%s call_id=%s error=%s",
                plugin,
                method,
                call_id,
                e,
                exc_info=True,
            )
            return f"Error executing client tool: {str(e)}"
        finally:
            self.pending_client_tool_results.pop(call_id, None)

    async def handle_frame(self, frame: Frame):
        """Process an incoming frame."""
        try:
            if frame.op == Op.MESSAGE:
                await self.handle_user_message(frame)
            elif frame.op == Op.STOP:
                # STOP is handled by RedisWorker via task.cancel()
                # This path shouldn't be reached for STOP since Worker handles it directly
                self.cancel_event.set()
            else:
                logger.warning("[RedisSession] Unsupported op: %s", frame.op)
        except asyncio.CancelledError:
            # Proactively repair dangling tool calls to prevent corrupted history on next run
            if self.agent:
                try:
                    await self._repair_dangling_tool_calls(self.agent)
                except Exception as e:
                    logger.error(
                        "[RedisSession] Failed to repair dangling tools during cancellation: %s",
                        e,
                    )
            raise  # Re-raise to let RedisWorker handle it
        finally:
            # Clean up resources
            await self._cleanup_result_listener()
            if self.redis_client:
                await self.redis_client.close()

    async def build_agent_instance(
        self, payload: dict, storage_backend: StorageBackend | None = None
    ):
        """Build the agent based on payload parameters."""
        # Extract params from payload or defaults
        self.current_model_name = payload.get("model")
        self._model_supports_vision_cache = None
        endpoint = payload.get("endpoint")
        self.streaming = bool(payload.get("streaming", False))

        thinking = payload.get("thinking")
        if thinking is not None:
            if isinstance(thinking, bool):
                self.current_thinking = "medium" if thinking else "off"
            elif isinstance(thinking, str):
                self.current_thinking = thinking.lower()

        # Tools: We don't have the TOOLS frame handshake here.
        # We rely on AgentFactory fetching tools from API using user_id.
        # IF tools are passed in payload (rare), we could parse them.

        self.agent_type = payload.get("agent_type", "nomi")
        self.single_chat_mode = bool(payload.get("single_chat_mode", False))

        # BYOK: user-supplied LLM provider keys injected by the Go API as
        # "<provider>_api_key". Collected for the opencode-driven developer agent.
        self.byok = {
            p: payload[f"{p}_api_key"]
            for p in ("anthropic", "google", "openrouter", "zai")
            if payload.get(f"{p}_api_key")
        }
        self.byok_default = payload.get("byok_default_provider", "")
        self.command_desc = payload.get("command") or payload.get("team")
        if self.command_desc is None:
            self.command_desc = {}
        elif not isinstance(self.command_desc, dict):
            try:
                self.command_desc = (
                    json.loads(self.command_desc)
                    if isinstance(self.command_desc, str)
                    else {}
                )
            except (json.JSONDecodeError, TypeError):
                self.command_desc = {}
        if isinstance(self.command_desc, dict):
            self.command_desc["streaming"] = self.streaming

        rag_user_id = self.user_id or self.session_id

        try:
            if self.command_desc and isinstance(self.command_desc, dict):
                # Inject auth token if available in payload but not in command_desc
                if "auth_token" not in self.command_desc:
                    token = (
                        payload.get("auth_token")
                        or payload.get("token")
                        or payload.get("access_token")
                    )
                    if token:
                        self.command_desc["auth_token"] = token

            # Using regular agent factory
            client_tool_runner = (
                self._send_client_action_and_wait if self.redis_worker else None
            )
            # Inside a task run we (a) don't allow delegate_to(background=True)
            # (a task must not spawn sub-tasks) and (b) relax the sandbox engineer
            # limits. We also skip persisting synchronous delegations there, since
            # the parent task already owns its AgentTask row.
            in_task_run = getattr(self, "_in_task_run", False)
            task_spawner = (
                self._spawn_background_task
                if (self.redis_worker and not in_task_run)
                else None
            )
            sync_delegation_emitter = (
                self._make_sync_delegation_emitter
                if (self.redis_worker and not in_task_run)
                else None
            )
            bot_identity = payload.get("bot_identity") or None
            user_location = payload.get("user_location") or None
            timezone = payload.get("timezone") or None
            self.agent = await self.agent_factory.build(
                session_id=self.session_id,
                tools_specs=self.tools_specs,  # Likely empty, factory will fetch
                model_name=self.current_model_name,
                agent_type=self.agent_type,
                command_desc=self.command_desc,
                web_search=False,  # Default
                thinking=self.current_thinking,
                user_id=rag_user_id,
                chat_id=self.chat_id,
                endpoint=endpoint,
                client_tool_runner=client_tool_runner,
                bot_identity=bot_identity,
                user_location=user_location,
                timezone=timezone,
                single_chat_mode=self.single_chat_mode,
                storage_backend=storage_backend or self.storage_backend,
                task_spawner=task_spawner,
                sync_delegation_emitter=sync_delegation_emitter,
                task_mode=in_task_run,
                byok=self.byok,
                byok_default=self.byok_default,
                project_id=(
                    (self._project_context or {}).get("id")
                    if isinstance(getattr(self, "_project_context", None), dict)
                    else None
                ),
            )
        except Exception as e:
            logger.error(
                "[RedisSession] Failed to build agent: %s",
                e,
                exc_info=True,
                extra={
                    "chat_id": self.chat_id,
                    "user_id": self.user_id,
                    "agent_type": self.agent_type,
                },
            )
            await self._send_frame(
                make_error(
                    self.next_id,
                    "build_failed",
                    self.chat_id,
                    f"Failed to build agent: {str(e)}",
                    http=500,
                    details={
                        "error_type": type(e).__name__,
                        "agent_type": self.agent_type,
                        "chat_id": self.chat_id,
                        "user_id": self.user_id,
                    },
                )
            )
            raise

    def _parse_tools(self, payload: Any):
        """Parse tools from payload."""
        if not payload:
            return
        if not isinstance(payload, dict):
            payload = payload if hasattr(payload, "__dict__") else {}

        tools_obj = payload.get("tools") if isinstance(payload, dict) else None
        tools_data: list[Any] = []

        if isinstance(tools_obj, dict):
            tools_data = tools_obj.get("tools", [])
        elif isinstance(tools_obj, list):
            tools_data = tools_obj

        if isinstance(tools_data, list):
            for tool_dict in tools_data:
                self._parse_tool_item(tool_dict)

        # Also check for command/team desc in payload
        cmd_obj = payload.get("command") if isinstance(payload, dict) else None
        if cmd_obj is None and isinstance(payload, dict):
            cmd_obj = payload.get("team")

        if cmd_obj:
            if isinstance(cmd_obj, str):
                try:
                    cmd_obj = json.loads(cmd_obj)
                except json.JSONDecodeError:
                    pass
            if isinstance(cmd_obj, dict):
                self.command_desc = cmd_obj
                # If model is not set, set it from command
                if self.current_model_name is None:
                    self.current_model_name = cmd_obj.get("model")
                    self._model_supports_vision_cache = None
                elif cmd_obj.get("model") and cmd_obj.get("model") != self.current_model_name:
                    self.current_model_name = cmd_obj.get("model")
                    self._model_supports_vision_cache = None

    def _parse_tool_item(self, tool_dict: Any):
        """Parse a single tool item from the tools list."""
        if not isinstance(tool_dict, dict):
            return
        try:
            params = self._extract_tool_params(tool_dict)


            tool_spec = ToolSpec(
                name=tool_dict.get("name", ""),
                provider=tool_dict.get("provider"),
                enabled=tool_dict.get("enabled", True),
                params=params if isinstance(params, dict) else {},
            )
            self.tools_specs.append(tool_spec)
        except Exception as e:
            logger.warning("[RedisSession] Failed to parse tool: %s", e)

    def _extract_tool_params(self, tool_dict: dict) -> dict:
        """Extract and normalize tool parameters from tool dictionary."""
        # First try nested "params" key
        params = tool_dict.get("params", {})
        if isinstance(params, str):
            try:
                params = json.loads(params)
            except json.JSONDecodeError:
                params = {}

        # IMPORTANT: Also merge top-level keys (like user_id) into params
        # Go sends: {"name": "knowledge_search", "enabled": true, "user_id": "..."}
        # So user_id is at top level, not inside "params"
        for key in (
            "user_id",
            "list_id",  # list chat: manage list items via agent
            "access_token",
            "token",
            "auth_token",
            "creds",
            "account_email",
            "api_key",  # Jules API key from frontend
        ):
            if key in tool_dict and key not in params:
                params[key] = tool_dict[key]

        return params

    def _parse_history(self, payload: Any):
        if payload and isinstance(payload, dict):
            history_data = payload.get("history", [])
            if isinstance(history_data, list):
                for msg in history_data:
                    if isinstance(msg, dict):
                        self.chat_history.append(
                            {
                                "role": msg.get("role", "user"),
                                "content": msg.get("text") or msg.get("content", ""),
                                "id": msg.get("id", ""),
                                "timestamp": msg.get("created_at") or msg.get("timestamp", ""),
                            }
                        )

    async def _extract_and_store_facts(self, text: str) -> None:
        """
        Run memory extraction in background: extract facts from current message + recent
        history and store in shared Knowledge with user_id in metadata. Does not block the main chat response.
        """
        user_id = self.user_id
        if not user_id or not (text or "").strip():
            return
        try:
            # Access _knowledge directly from agent_factory (it's a private attribute)
            knowledge = getattr(self.agent_factory, "_knowledge", None)
            if not knowledge:
                return

            # Check if db is available
            db = getattr(self.agent_factory, "_db", None)
            if db is None:
                return

            model = self.agent_factory.build_model(
                self.current_model_name or "gemini-2.5-flash-lite",
                thinking="off",
            )

            memoriser = NomiAgent(
                db=db,
                model=model,
                knowledge=knowledge,
                user_id=user_id,
                debug_mode=getattr(self.agent_factory, "_debug_mode", False),
            )
            last_n = 5
            history_snippet = ""
            if self.chat_history:
                recent = self.chat_history[-last_n:]
                lines = [
                    f"{'User' if h['role'] == 'user' else 'Assistant'}: {h['content']}"
                    for h in recent
                ]
                history_snippet = "Conversation:\n" + "\n".join(lines) + "\n\n"
            prompt = (
                f"{history_snippet}User message: {text.strip()}\n\n"
                "Extract 0-5 facts/preferences/constraints to remember (one per line, clear standalone statements)."
            )
            response = await memoriser.arun(prompt, stream=False)
            content = getattr(response, "content", None) or ""
            # If the model returned an error message instead of facts, skip entirely
            content_lower = content.lower()
            if any(
                kw in content_lower
                for kw in (
                    "rate limit",
                    "ratelimit",
                    "429",
                    "too many requests",
                    "freeusagelimit",
                    "error code",
                    "please try again",
                    "exceeded",
                )
            ):
                return
            if isinstance(content, str):
                for line in content.splitlines():
                    fact = line.strip()
                    if not fact or len(fact) < 3:
                        continue
                    if fact.startswith(("-", "*", "•", "1.", "2.", "3.", "4.", "5.")):
                        fact = fact.lstrip("-*•0123456789. ")
                    if fact:
                        try:
                            # Skip if a near-identical fact already exists for this user
                            existing = knowledge.search(
                                query=fact,
                                filters={"user_id": user_id},
                                num_documents=1,
                            )
                            if existing:
                                top = existing[0]
                                top_content = getattr(top, "content", "") or ""
                                # Normalise both strings for comparison
                                def _norm(s: str) -> str:
                                    return re.sub(r"\s+", " ", s.lower().strip())
                                if _norm(top_content) == _norm(fact):
                                    continue
                            knowledge.insert(
                                text_content=fact,
                                metadata={"user_id": user_id},
                            )
                        except Exception as e:
                            logger.warning(
                                "[RedisSession] Failed to store fact %s: %s",
                                fact[:50],
                                e,
                            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning(
                "[RedisSession] Memory extraction failed (non-fatal): %s",
                e,
                exc_info=True,
                extra={"user_id": user_id},
            )

    def _schedule_deferred_learning(
        self, chat_id: str, user_text: str, assistant_text: Any
    ) -> None:
        """Accumulate this turn and (re)arm the idle debounce timer for learning.

        Extraction (profile/entities/memories) runs only after the user pauses
        (``LEARN_DEBOUNCE_MS``), so it never competes with an active reply; a
        burst of back-to-back turns batches into a single extraction pass.
        """
        if not self.user_id or not (user_text or "").strip():
            return
        try:
            entry = _learn_entry(chat_id)
            entry["messages"].append(Message(role="user", content=user_text))
            if assistant_text:
                entry["messages"].append(
                    Message(role="assistant", content=str(assistant_text))
                )
            entry["ctx"] = {
                "agent_factory": self.agent_factory,
                "db": getattr(self.agent_factory, "_db", None),
                "user_id": self.user_id,
                "session_id": self.session_id,
                "model_name": self.current_model_name,
            }
            timer = entry.get("timer")
            if timer is not None and not timer.done():
                timer.cancel()
            t = asyncio.create_task(_deferred_learning_timer(chat_id))
            entry["timer"] = t
            _learn_bg_tasks.add(t)
            t.add_done_callback(_learn_bg_tasks.discard)
        except Exception as e:
            logger.warning(
                "[RedisSession] Failed to schedule deferred learning (non-fatal): %s",
                e,
            )

    async def handle_user_message(self, frame: Frame):
        payload = frame.payload or {}
        text = payload.get("message", "")
        message_id = str(uuid.uuid4())

        # --- PROACTIVE BRANCH ---
        # If the payload has source="proactive" and a proactive_event key, synthesize
        # the agent input from the event rather than waiting for user text.
        # Reset per-message proactive metadata; set below if this is a proactive event.
        self._proactive_meta = None
        if payload.get("source") == "proactive" and payload.get("proactive_event"):
            from src.agents.factory import (
                build_proactive_deep_link,
                build_proactive_prompt,
            )
            proactive_event = payload["proactive_event"]
            event_type = proactive_event.get("event_type", "unknown")
            event_payload = proactive_event.get("payload", {})
            text = build_proactive_prompt(event_type, event_payload)
            # Carry meta (incl. native deep_link) onto the response so the client can
            # render the source badge + "Open" button. This is the single point that
            # propagates proactive meta for every surface path (direct + judge).
            self._proactive_meta = {
                "event_id": proactive_event.get("event_id"),
                "event_type": event_type,
                "deep_link": build_proactive_deep_link(event_type, event_payload),
            }

        # --- NEW LOGIC: Init from Payload ---

        # Reset delivery context at the start of each request
        self._delivery_source = None
        self._delivery_context = {}

        # 0. Extract user_id first (critical for RAG)
        incoming_user_id = payload.get("user_id")
        if incoming_user_id:
            self.user_id = str(incoming_user_id)

        # 0-pre. Request-level idempotency + pickup ACK.
        # The Go hub stamps a stable request_id (= user message UUID) and may
        # re-publish a request once if it never sees a pickup ACK. Guard against
        # processing the same turn twice, then immediately acknowledge pickup so
        # the hub cancels its re-publish window before model latency kicks in.
        request_id = payload.get("request_id") or payload.get("message_id")
        if request_id and self.redis_client and payload.get("source") != "proactive":
            try:
                acquired = await self.redis_client.set(
                    f"chat:req:{request_id}", "1", nx=True, ex=120
                )
                if not acquired:
                    logger.warning(
                        "[RedisSession] Duplicate request_id %s for chat %s — skipping",
                        request_id,
                        self.chat_id,
                    )
                    return
            except Exception as e:
                # Idempotency is best-effort; never block a real request on it.
                logger.warning(
                    "[RedisSession] Idempotency check failed for %s: %s",
                    request_id,
                    e,
                )
        if request_id:
            try:
                await self._send_frame(
                    make_signal(
                        self.next_id,
                        Op.ACK,
                        self.chat_id,
                        {"type": "generation_started", "request_id": str(request_id)},
                    )
                )
            except Exception as e:
                logger.warning("[RedisSession] Failed to send generation_started ACK: %s", e)

        # 0-stub. Deterministic e2e regression mode: known magic inputs emit a
        # fixed frame sequence and skip the real agent/LLM path entirely. The
        # ACK above is already sent, so the contract is ACK -> <stub frames>.
        if stub_brain.is_enabled():
            stub_frames = stub_brain.stub_message_frames(text, self.chat_id, message_id)
            if stub_frames is not None:
                for make_frame in stub_frames:
                    await self._send_frame(make_frame(self.next_id))
                return

        # 0a. Build storage backend based on per-user feature flag
        agent_storage_mode = payload.get("agent_storage_mode", "payload")
        self.storage_backend = create_storage_backend(
            agent_storage_mode=agent_storage_mode,
            chat_history=payload.get("history") or [],
            session_id=self.session_id,
        )

        # 0b. Extract plugin delivery context from payload
        self._delivery_source = payload.get("source")
        if self._delivery_source:
            # Collect all plugin-specific context keys from payload
            standard_keys = {
                "message",
                "role",
                "source",
                "message_id",
                "trace_id",
                "history",
                "tools",
                "command",
                "team",
                "attachments",
                "extracted_facts",
                "context_items",
                "proactive_event",
            }
            self._delivery_context = {
                k: v for k, v in payload.items() if k not in standard_keys
            }

        # 1. Check and update chat history (payload mode only; agno mode loads history internally)
        incoming_history = payload.get("history")
        if incoming_history and isinstance(self.storage_backend, PayloadBackend):
            # Replace history on each message to avoid duplication across reused sessions
            self.chat_history = []
            self._parse_history(payload)

        # 2. Check and update tools/commands
        if payload.get("tools") or payload.get("command") or payload.get("team"):
            self._parse_tools(payload)
            # If tools updated, we might need to assume agent needs rebuild (which happens below anyway)

        # ------------------------------------

        # Project context: when the chat belongs to a project, the Go API sends
        # the project's id/name/description so (a) the project is injected into the
        # agent input in _build_agent_input and (b) the agent's knowledge search is
        # scoped to this project's documents (union with general knowledge). Must be
        # set BEFORE build_agent_instance so project_id reaches the agent wrapper.
        incoming_project_context = payload.get("project_context")
        self._project_context = (
            incoming_project_context
            if isinstance(incoming_project_context, dict)
            else None
        )

        # Build agent
        await self.build_agent_instance(payload, storage_backend=self.storage_backend)

        # Optionally store client-extracted facts from payload (e.g. from sync path)
        incoming_facts = payload.get("extracted_facts")
        if incoming_facts and self.user_id:
            try:
                knowledge = getattr(self.agent_factory, "_knowledge", None)
                if knowledge and isinstance(incoming_facts, list):
                    for fact in incoming_facts:
                        if isinstance(fact, str) and fact.strip():
                            try:
                                knowledge.insert(
                                    text_content=fact.strip(),
                                    metadata={"user_id": str(self.user_id)},
                                )
                            except Exception as e:
                                logger.warning(
                                    "[RedisSession] Failed to store client fact: %s", e
                                )
            except Exception as e:
                logger.warning("[RedisSession] Failed to store extracted_facts: %s", e)

        # Extract and store context items (emails, documents, etc.)
        incoming_context_items = payload.get("context_items")
        if incoming_context_items:
            if isinstance(incoming_context_items, list):
                self.context_items = incoming_context_items
            else:
                logger.warning(
                    "[RedisSession] Invalid context_items type: %s",
                    type(incoming_context_items).__name__,
                )
        else:
            # Clear context items if not provided (user removed them)
            self.context_items = []

        # Run memory extraction in background (does not block response).
        # Only when ENABLE_MEMORY=true to avoid extra LLM calls and storing noise.
        _enable_memory = getattr(self.agent_factory, "_enable_memory", False)
        if _enable_memory and payload.get("role") != "system":
            asyncio.create_task(self._extract_and_store_facts(text))

        # If we have history and the agent supports it, we might want to load it.
        # But commonly the Agent loads from DB based on session_id.
        # If we want to use the push-history, we might need to manually set it.
        # However, for now, we follow the user's request to just parse it.

        msg_chat_id = frame.chat_id or self.chat_id

        # Send Meta (Empty message bubble fix: Frontend filters it, but backend needs to reserve ID?)
        # Actually, Go backend already has the message ID from the user?
        # No, this message_id is for the Response.
        # We still send it.
        # FIX: Added "type": "metadata" to satisfy Go backend validation
        meta_payload: dict[str, Any] = {"message_id": message_id, "type": "metadata"}
        if self._proactive_meta is not None:
            meta_payload["proactive_event"] = self._proactive_meta
        await self._send_frame(
            make_meta(
                self.next_id,
                Op.MESSAGE,
                msg_chat_id,
                meta_payload,
            )
        )

        self._last_run_completed_content = None
        idx = 0
        done_sent = False

        # Resolve delivery handler for external channels (e.g. Telegram)
        from src.server.delivery import DeliveryRegistry

        delivery_handler = (
            DeliveryRegistry.get(self._delivery_source)
            if self._delivery_source
            else None
        )
        delivery_text_buffer: list[str] = []

        try:
            # For planner chats in workflow stages (not ITERATE), use the multi-stage
            # planning workflow. In ITERATE status, fall through to the regular planner agent.
            is_planner = (
                isinstance(self.command_desc, dict)
                and self.command_desc.get("type", "").lower() == "planner"
            )
            used_workflow = False

            if is_planner:
                planner_state = await self._load_planner_session_state()
                is_replan = text.strip().lower().startswith("/replan")
                if is_replan:
                    # Reset session state for full replan
                    planner_state = {}
                if self._should_use_workflow(planner_state, text):
                    used_workflow = True
                    # Emit planning stage status before running
                    current_stage = planner_state.get("status", "extract")
                    stage_text = STAGE_STATUS_TEXT.get(current_stage, "Planning...")
                    await self._send_frame(
                        make_generation_status(self.next_id, msg_chat_id, stage_text)
                    )
                    workflow_chunks = await self._run_planning_workflow_steps(
                        user_message=text,
                        payload=payload,
                        session_state=planner_state,
                        msg_chat_id=msg_chat_id,
                        message_id=message_id,
                    )
                    if delivery_handler and workflow_chunks:
                        full_text = "".join(workflow_chunks)
                        if full_text:
                            await self._safe_deliver(delivery_handler, full_text)
                    # Workflow manages its own done frame below — skip agent path
                    if not done_sent:
                        await self._send_frame(
                            make_done(
                                self.next_id, msg_chat_id, {"message_id": message_id}
                            )
                        )
                        done_sent = True

            if not used_workflow:
                await self._send_frame(
                    make_generation_status(self.next_id, msg_chat_id, "Thinking...")
                )
                stream_iter = self._stream_agent_events(
                    text, payload.get("attachments")
                )
                async for event in stream_iter:
                    if self.cancel_event.is_set():
                        break

                    evt_type = event.get("type")

                    if evt_type == "content_done":
                        # Content generation is complete — send DONE immediately
                        # without waiting for learning/memory background tasks.
                        done_payload: dict[str, Any] = {"message_id": message_id}
                        completed_content = getattr(
                            self, "_last_run_completed_content", None
                        )
                        if completed_content is not None:
                            done_payload["content"] = str(completed_content)
                        await self._send_frame(
                            make_done(self.next_id, msg_chat_id, done_payload)
                        )
                        done_sent = True

                        # Archive old messages if context window is too full
                        # (payload mode only; agno mode compresses via enable_session_summaries)
                        if isinstance(self.storage_backend, PayloadBackend):
                            try:
                                await self._maybe_archive_old_messages()
                            except asyncio.CancelledError:
                                raise
                            except Exception as _arch_err:
                                logger.warning(
                                    "[RedisSession] _maybe_archive_old_messages failed (non-fatal): %s",
                                    _arch_err,
                                )

                        # Deliver to external channel via plugin delivery handler
                        if delivery_handler:
                            full_text = "".join(delivery_text_buffer)
                            if not full_text and completed_content:
                                full_text = str(completed_content)
                            if full_text:
                                await self._safe_deliver(delivery_handler, full_text)

                        # Profile/entity/memory extraction is deferred OFF the
                        # reply path: accumulate this turn and (re)arm the idle
                        # debounce timer (extraction runs only after the user
                        # pauses, so it never contends with reply generation).
                        if payload.get("role") != "system":
                            self._schedule_deferred_learning(
                                msg_chat_id, text, completed_content
                            )

                        # Drain the remaining stream in background so the agent
                        # run finishes cleanly without blocking the client.
                        async def _drain_remaining(it):
                            try:
                                async for ev in it:
                                    # Process RunCompleted to capture final content
                                    ev_type = (
                                        ev.get("type") if isinstance(ev, dict) else None
                                    )
                                    if ev_type == "text" and ev.get("content"):
                                        # Late text after content_done — update stored content
                                        pass
                            except asyncio.CancelledError:
                                raise
                            except Exception as e:
                                logger.warning(
                                    "[RedisSession] Error draining post-done stream: %s",
                                    e,
                                )

                        asyncio.create_task(_drain_remaining(stream_iter))
                        break

                    elif evt_type == "text":
                        chunk = event.get("content", "")
                        agent_name = event.get("agent_name")
                        if chunk:
                            if delivery_handler and delivery_handler.should_buffer():
                                delivery_text_buffer.append(chunk)
                            payload_data = {
                                "ix": idx,
                                "eof": False,
                                "message": chunk,
                                "message_id": message_id,
                            }
                            if agent_name:
                                payload_data["agent_name"] = agent_name
                            await self._send_frame(
                                make_data(
                                    self.next_id, Op.MESSAGE, msg_chat_id, payload_data
                                )
                            )
                            idx += 1

                    elif evt_type == "member_response":
                        chunk = event.get("content", "")
                        if chunk:
                            if delivery_handler and delivery_handler.should_buffer():
                                delivery_text_buffer.append(chunk)
                            # Send as a regular message part, but you might want to mark it
                            # so the frontend knows who sent it.
                            payload_data = {
                                "ix": idx,
                                "eof": False,
                                "message": chunk,
                                "message_id": message_id,
                                "agent_name": event.get(
                                    "agent_name"
                                ),  # Pass agent name
                                "type": "member_response",
                            }
                            await self._send_frame(
                                make_data(
                                    self.next_id, Op.MESSAGE, msg_chat_id, payload_data
                                )
                            )
                            idx += 1

                    elif evt_type == "tool_call":
                        tool_data = event.get("tool", {})
                        safe_tool = {
                            "name": getattr(tool_data, "tool_name", "unknown")
                            if hasattr(tool_data, "tool_name")
                            else tool_data.get("name", "unknown"),
                            "arguments": getattr(tool_data, "tool_args", {})
                            if hasattr(tool_data, "tool_args")
                            else tool_data.get("arguments", {}),
                            "result": getattr(tool_data, "result", None)
                            if hasattr(tool_data, "result")
                            else tool_data.get("result", None),
                        }

                        # Handle mock/legacy
                        if hasattr(tool_data, "name") and not isinstance(
                            tool_data, dict
                        ):
                            safe_tool["name"] = tool_data.name

                        # Handle suggest_actions
                        # ... (Omitting complex suggestion logic for MVP, can add if needed)

                        await self._send_frame(
                            make_data(
                                self.next_id,
                                Op.MESSAGE,
                                msg_chat_id,
                                {
                                    "type": "tool_call",
                                    "tool": safe_tool,
                                    "message_id": message_id,
                                    "agent_name": event.get("agent_name"),
                                },
                            )
                        )

                        # If tool result contains "actions", emit an actions frame so the
                        # client can render tappable buttons (e.g. "Open in Maps").
                        # Generic — any tool returning {"text": "...", "actions": [...]} benefits.
                        tool_result_str = safe_tool.get("result")
                        if tool_result_str:
                            try:
                                result_data = json.loads(tool_result_str)
                                if isinstance(result_data, dict) and result_data.get("actions"):
                                    await self._send_frame(
                                        make_data(
                                            self.next_id,
                                            Op.MESSAGE,
                                            msg_chat_id,
                                            {
                                                "type": "actions",
                                                "actions": result_data["actions"],
                                                "message_id": message_id,
                                            },
                                        )
                                    )
                            except (json.JSONDecodeError, TypeError, AttributeError):
                                pass  # plain-text result, no actions to dispatch

                    elif evt_type == "reasoning":
                        content = event.get("content", "")
                        agent_name = event.get("agent_name")
                        if content:
                            payload_data = {
                                "type": "reasoning",
                                "content": content,
                                "message_id": message_id,
                            }
                            if agent_name:
                                payload_data["agent_name"] = agent_name
                            await self._send_frame(
                                make_data(
                                    self.next_id, Op.MESSAGE, msg_chat_id, payload_data
                                )
                            )

                    elif evt_type == "error":
                        # Handle agent errors (e.g., RunErrorEvent from Agno)
                        error_message = event.get("message", "Agent execution failed")
                        error_code = event.get("code", "agent_error")
                        error_details = event.get("details", {})
                        error_http = event.get("http", 500)

                        logger.error(
                            "[RedisSession] Agent error event: %s",
                            error_message,
                            extra={
                                "chat_id": msg_chat_id,
                                "user_id": self.user_id,
                                "error_code": error_code,
                                "error_details": error_details,
                            },
                        )

                        await self._send_frame(
                            make_error(
                                self.next_id,
                                error_code,
                                msg_chat_id,
                                error_message,
                                http=error_http,
                                details=error_details,
                            )
                        )
                        # Don't send done frame after error - error frame is terminal
                        return

            # Fallback: if content_done was never received (e.g. older Agno
            # version or non-streaming agent), send DONE after the stream ends.
            if not done_sent:
                done_payload_fb: dict[str, Any] = {"message_id": message_id}
                completed_content = getattr(self, "_last_run_completed_content", None)
                if completed_content is not None:
                    done_payload_fb["content"] = str(completed_content)
                await self._send_frame(
                    make_done(self.next_id, msg_chat_id, done_payload_fb)
                )
                # Defer learning here too (content_done path didn't run).
                if payload.get("role") != "system":
                    self._schedule_deferred_learning(
                        msg_chat_id, text, completed_content
                    )
                # Deliver to external channel via plugin delivery handler (fallback path)
                if delivery_handler:
                    full_text = "".join(delivery_text_buffer)
                    if not full_text and completed_content:
                        full_text = str(completed_content)
                    if full_text:
                        await self._safe_deliver(delivery_handler, full_text)

        except asyncio.CancelledError:
            raise  # Re-raise to propagate cancellation
        except Exception as e:
            trace_id = frame.trace_id if hasattr(frame, "trace_id") else None
            logger.error(
                "[RedisSession] Error streaming: %s",
                e,
                exc_info=True,
                extra={
                    "chat_id": msg_chat_id,
                    "user_id": self.user_id,
                    "trace_id": trace_id,
                },
            )
            await self._send_frame(
                make_error(
                    self.next_id,
                    "stream_failed",
                    msg_chat_id,
                    f"Streaming failed: {str(e)}",
                    http=500,
                    details={
                        "error_type": type(e).__name__,
                        "chat_id": msg_chat_id,
                        "user_id": self.user_id,
                        "trace_id": trace_id,
                    },
                )
            )

    async def _stream_agent_events(
        self, text: str, attachments: list | None
    ) -> AsyncIterator[dict]:
        """Stream agent events and yield formatted event dictionaries."""
        # Prepare inputs
        kwargs: dict[str, Any] = {}
        # Only pass session_id for non-team mode
        if (
            self.session_id
            and self.command_desc
            and self.command_desc.get("type", "agent") != "team"
        ):
            kwargs["session_id"] = self.session_id

        agent_input = self._build_agent_input(text)

        if attachments:
            # Extract text from document attachments (e.g. PDFs) so the agent can
            # read them directly, without depending on the sandbox.
            pdf_texts = self._extract_document_texts(attachments)
            if pdf_texts:
                agent_input = (
                    "[The user attached document(s). Extracted text content "
                    f"below:\n{pdf_texts}\n]\n\n{agent_input}"
                )

            bridge_model = self._get_vision_bridge_model()
            if bridge_model:
                descriptions = await self._vision_bridge_describe_images(attachments, bridge_model)
                if descriptions:
                    agent_input = (
                        f"[The user has attached an image. A vision model analyzed it and produced the following description:\n{descriptions}]\n\n"
                        f"{agent_input}"
                    )
            elif self._model_supports_vision():
                images = self._process_attachments(attachments)
                if images:
                    kwargs["images"] = images

        agent = self.agent
        if not agent:
            raise ValueError("Agent not initialized")

        result = await self._invoke_agent(agent, agent_input, kwargs)
        if not result:
            return

        # Iterate stream
        async for event in self._iterate_agent_stream(result):
            yield event

    def _build_history_messages(self, current_text: str) -> list:
        """Build a list of Agno Message objects from chat_history + current message.

        Used by PayloadBackend mode so the LLM sees proper multi-turn messages
        instead of an embedded history text block in a single user message.
        """
        from agno.models.message import Message

        msgs = [
            Message(role=h["role"], content=h["content"])
            for h in self.chat_history
            if h.get("content")
        ]
        if current_text and current_text.strip():
            msgs.append(Message(role="user", content=current_text))
        return msgs

    def _build_agent_input(self, text: str) -> str:
        """Build agent input with context items and accumulated tool results."""
        context_parts = []

        # Project context (the project's description is its "document"): keep the
        # agent aware of the project this chat belongs to.
        project_context = getattr(self, "_project_context", None)
        if isinstance(project_context, dict):
            name = (project_context.get("name") or "").strip()
            description = (project_context.get("description") or "").strip()
            if name or description:
                lines = ["--- Project ---"]
                if name:
                    lines.append(f"Name: {name}")
                if description:
                    lines.append(f"Description: {description}")
                lines.append("--- End Project ---")
                context_parts.append("\n".join(lines))

        # Add context items (emails, documents, etc.)
        if self.context_items:
            context_lines = []
            for item in self.context_items:
                if isinstance(item, dict):
                    source_type = item.get("sourceType", "item")
                    title = item.get("title", "Untitled")
                    preview = item.get("preview", "")
                    metadata = item.get("metadata", {})

                    if source_type == "email":
                        from_email = metadata.get("from", "")
                        subject = title
                        date = metadata.get("date", "")
                        context_lines.append(f"📧 Email from {from_email}: {subject}")
                        if date:
                            context_lines.append(f"   Date: {date}")
                        if preview:
                            context_lines.append(f"   Preview: {preview[:200]}")
                    elif source_type == "document":
                        context_lines.append(f"📄 Document: {title}")
                        if preview:
                            context_lines.append(f"   Preview: {preview[:200]}")
                    elif source_type == "image":
                        context_lines.append(f"🖼️ Image: {title}")
                    elif source_type == "task":
                        context_lines.append(f"✅ Task: {title}")
                        if preview:
                            context_lines.append(f"   Details: {preview[:200]}")
                    elif source_type == "note":
                        context_lines.append(f"📝 Note: {title}")
                        if preview:
                            context_lines.append(f"   Preview: {preview[:200]}")
                    elif source_type == "location":
                        lat = metadata.get("lat")
                        lon = metadata.get("lon")
                        if lat is not None and lon is not None:
                            context_lines.append(
                                f"📍 Location: {title} (coordinates: {lat},{lon})"
                            )
                        else:
                            context_lines.append(f"📍 Location: {title}")
                    else:
                        context_lines.append(f"📎 {source_type.title()}: {title}")

            if context_lines:
                context_parts.append(
                    "--- Context Items (emails, documents, etc.) ---\n"
                    + "\n".join(context_lines)
                    + "\n--- End Context Items ---"
                )

        # Accumulated tool results
        if self._accumulated_tool_results:
            tool_results_lines = []
            for idx, tool_result in enumerate(self._accumulated_tool_results):
                tool_name = tool_result.get("name", "unknown")
                result_data = tool_result.get("result")
                if result_data:
                    tool_results_lines.append(f"**Tool Result {idx + 1}:**")
                    tool_results_lines.append(f"Tool: {tool_name}")
                    tool_results_lines.append(
                        f"Result: {str(result_data)[:200]}..."
                    )
                else:
                    tool_results_lines.append(f"**Tool Result {idx + 1}:**")
                    tool_results_lines.append(f"Tool: {tool_name}")
                    tool_results_lines.append("Result: No result data")

            if tool_results_lines:
                context_parts.append("\\n".join(tool_results_lines) + "\\n")
                self._accumulated_tool_results.clear()

        # Combine all context parts (including tool results)
        if context_parts:
            combined_context = "\n\n".join(context_parts)
            if text:
                return f"{combined_context}\n\nUser's new message: {text}"
            else:
                return combined_context

        return text

    def _process_attachments(self, attachments: list) -> list[Image]:
        """Process attachments and extract images."""
        images = []
        for att in attachments:
            if isinstance(att, dict) and att.get("file_type", "").startswith("image/"):
                content = att.get("content")
                if not content:
                    continue
                try:
                    image_bytes = base64.b64decode(content)
                    mime = att.get("file_type", "image/jpeg")
                    fmt = mime.split("/")[-1] if "/" in mime else mime
                    images.append(
                        Image(content=image_bytes, format=fmt, mime_type=mime)
                    )
                except Exception as e:
                    logger.error("[RedisSession] Image decode error: %s", e)
        return images

    def _extract_document_texts(self, attachments: list) -> str:
        """Extract plain text from document attachments (currently PDFs).

        Returns the concatenated text, or "" if nothing could be extracted.
        Truncates very large documents to keep the prompt within budget.
        """
        MAX_CHARS_PER_DOC = 50_000

        sections: list[str] = []
        for att in attachments:
            if not isinstance(att, dict):
                continue
            if att.get("file_type", "") != "application/pdf":
                continue
            content = att.get("content")
            if not content:
                continue
            try:
                from pypdf import PdfReader
            except ImportError:
                logger.warning(
                    "[RedisSession] pypdf not installed; cannot read PDF attachment"
                )
                return ""
            try:
                import io

                pdf_bytes = base64.b64decode(content)
                reader = PdfReader(io.BytesIO(pdf_bytes))
                pages = [page.extract_text() or "" for page in reader.pages]
                text = "\n".join(pages).strip()
                if not text:
                    continue
                if len(text) > MAX_CHARS_PER_DOC:
                    text = text[:MAX_CHARS_PER_DOC] + "\n…[truncated]"
                name = att.get("file_name", "document.pdf")
                sections.append(f"--- {name} ---\n{text}")
            except Exception as e:
                logger.error("[RedisSession] PDF extract error: %s", e)
        return "\n\n".join(sections)

    async def _invoke_agent(
        self, agent: Any, agent_input: str, kwargs: dict[str, Any]
    ) -> Any:
        """Invoke the agent with the given input and return the result."""

        # Helper: call fn and await the result only if it is a coroutine.
        # Using iscoroutinefunction is unreliable when the callable is a
        # regular-function wrapper around an async function (e.g. AgentRunWrapper).
        # Checking the *return value* handles all cases correctly:
        #   - async def fn          → returns coroutine → await it
        #   - def fn returning async generator (stream=True) → pass through
        #   - def fn returning plain value → pass through
        async def run_fn(fn):
            inp = agent_input
            if isinstance(inp, str):
                from src.storage.backend import PayloadBackend
                if self.chat_history and isinstance(self.storage_backend, PayloadBackend):
                    # Pass full multi-turn history so the LLM sees real conversation
                    # turns rather than an embedded text block in a single user message.
                    inp = self._build_history_messages(inp)
                elif not (inp and inp.strip()):
                    inp = "[continue from previous context]"

            result = fn(inp, stream=True, stream_events=True, **kwargs)
            if asyncio.iscoroutine(result):
                result = await result
            return result

        result = None
        try:
            if hasattr(agent, "arun"):
                result = await run_fn(agent.arun)
            elif hasattr(agent, "run"):
                result = await run_fn(agent.run)
            else:
                for m in ("generate", "respond", "chat"):
                    fn = getattr(agent, m, None)
                    if fn:
                        result = await run_fn(fn)
                        break
        except Exception as e:
            # Check for dangling tool call error from OpenAI (Error 400)
            # Message: 'No tool output found for function call call_...'
            if "No tool output found" in str(e) and "call_" in str(e):
                logger.warning(
                    "[RedisSession] Detected dangling tool call error. Attempting repair..."
                )
                try:
                    repaired = await self._repair_dangling_tool_calls(agent)
                    if repaired:
                        # Retry invocation
                        if hasattr(agent, "arun"):
                            result = await run_fn(agent.arun)
                        elif hasattr(agent, "run"):
                            result = await run_fn(agent.run)
                        else:
                            for m in ("generate", "respond", "chat"):
                                fn = getattr(agent, m, None)
                                if fn:
                                    result = await run_fn(fn)
                                    break
                        # If retry succeeded, return result
                        if result:
                            return result
                except Exception as repair_err:
                    logger.error("[RedisSession] Repair/Retry failed: %s", repair_err)
                    # Fall through to original error handling

            logger.error(
                "[RedisSession] Agent invocation failed: %s",
                e,
                exc_info=True,
                extra={"chat_id": self.chat_id, "user_id": self.user_id},
            )
            # Send error frame before raising
            try:
                msg_chat_id = self.chat_id
                await self._send_frame(
                    make_error(
                        self.next_id,
                        "agent_failed",
                        msg_chat_id,
                        f"Agent invocation failed: {str(e)}",
                        http=500,
                        details={
                            "error_type": type(e).__name__,
                            "chat_id": msg_chat_id,
                            "user_id": self.user_id,
                        },
                    )
                )
            except Exception as send_err:
                logger.error("[RedisSession] Failed to send error frame: %s", send_err)
            raise

        if not result:
            logger.error(
                "[RedisSession] No callable method found on agent",
                extra={"chat_id": self.chat_id, "user_id": self.user_id},
            )
            # Send error frame
            try:
                msg_chat_id = self.chat_id
                await self._send_frame(
                    make_error(
                        self.next_id,
                        "agent_not_found",
                        msg_chat_id,
                        "No callable method found on agent",
                        http=500,
                        details={
                            "chat_id": msg_chat_id,
                            "user_id": self.user_id,
                        },
                    )
                )
            except Exception as send_err:
                logger.error("[RedisSession] Failed to send error frame: %s", send_err)

        return result

    async def _dedup_user_memories(self) -> None:
        """Remove exact-duplicate agentic memories for the current user.

        The MemoryManager LLM sometimes adds the same memory on successive runs
        (e.g., "User is currently in Barcelona" dozens of times). This method
        reads all stored UserMemory rows, keeps the first occurrence of each
        normalised text, and deletes the rest. Runs as a background task.
        """
        if not self.user_id:
            return
        try:
            db = getattr(self.agent_factory, "_db", None)
            if db is None:
                return

            all_memories = db.get_user_memories(user_id=self.user_id)
            if not all_memories or len(all_memories) < 2:
                return

            def _norm(s: str) -> str:
                return re.sub(r"\s+", " ", (s or "").lower().strip())

            seen: set[str] = set()
            to_delete: list[str] = []
            for mem in all_memories:
                key = _norm(mem.memory or "")
                if key in seen:
                    if mem.memory_id:
                        to_delete.append(mem.memory_id)
                else:
                    seen.add(key)

            if to_delete:
                db.delete_user_memories(to_delete, user_id=self.user_id)
        except Exception as e:
            logger.warning("[RedisSession] Memory deduplication failed: %s", e)

    @staticmethod
    def _find_models_config() -> str | None:
        """Find config/models.json trying several locations (local dev and Docker)."""
        here = os.path.dirname(__file__)
        candidates = [
            os.environ.get("MODELS_CONFIG_PATH"),
            os.path.join(here, "..", "..", "config", "models.json"),       # /app/config (Docker)
            os.path.join(here, "..", "..", "..", "config", "models.json"), # repo root (local dev)
            "/app/config/models.json",                                      # Docker absolute fallback
        ]
        for path in candidates:
            if path and os.path.isfile(path):
                return path
        return None

    def _get_model_context_limit(self, model_name: str) -> int:
        """Return token context limit for the model from config/models.json. Falls back to 128_000."""
        if self._model_context_limit is not None:
            return self._model_context_limit

        config_path = self._find_models_config()
        if config_path:
            try:
                with open(config_path) as f:
                    data = json.load(f)
                for m in data.get("models", []):
                    if m.get("id") == model_name:
                        self._model_context_limit = m.get("context_window", 128_000)
                        return self._model_context_limit
            except Exception as exc:
                logger.warning("[RedisSession] Failed to load model config: %s", exc)

        self._model_context_limit = 128_000
        return self._model_context_limit

    def _model_supports_vision(self) -> bool:
        """Return True if current model supports vision input per config/models.json."""
        if not self.current_model_name:
            return False

        if self._model_supports_vision_cache is not None:
            return self._model_supports_vision_cache

        config_path = self._find_models_config()
        if config_path:
            try:
                with open(config_path) as f:
                    data = json.load(f)
                for m in data.get("models", []):
                    if m.get("id") == self.current_model_name:
                        self._model_supports_vision_cache = bool(m.get("supports_vision", False))
                        return self._model_supports_vision_cache
            except Exception as exc:
                logger.warning("[RedisSession] Failed to load model config for vision check: %s", exc)

        self._model_supports_vision_cache = False
        return False

    def _get_vision_bridge_model(self) -> str | None:
        """Return the vision bridge model ID for the current model, or None if not configured."""
        if not self.current_model_name:
            return None

        config_path = self._find_models_config()
        if config_path:
            try:
                with open(config_path) as f:
                    data = json.load(f)
                for m in data.get("models", []):
                    if m.get("id") == self.current_model_name:
                        return m.get("vision_bridge") or None
            except Exception as exc:
                logger.warning("[RedisSession] Failed to load model config for vision bridge: %s", exc)

        return None

    async def _vision_bridge_describe_images(
        self, attachments: list, bridge_model_id: str
    ) -> str:
        """Describe image attachments using a vision bridge model.

        Calls the z.ai vision model to convert images to text descriptions,
        mirroring the Vision Understanding MCP pattern for non-vision GLM models.
        """
        api_key = os.getenv("ZAI_API_KEY")
        if not api_key:
            logger.warning("[RedisSession] ZAI_API_KEY not set; cannot use vision bridge")
            return ""

        endpoint = "https://api.z.ai/api/coding/paas/v4/chat/completions"
        descriptions = []

        async with httpx.AsyncClient(timeout=30.0) as client:
            for i, att in enumerate(attachments, 1):
                if not isinstance(att, dict):
                    continue
                file_type = att.get("file_type", "")
                if not file_type.startswith("image/"):
                    continue
                content = att.get("content")
                if not content:
                    continue

                try:
                    data_uri = f"data:{file_type};base64,{content}"
                    payload = {
                        "model": bridge_model_id,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "image_url",
                                        "image_url": {"url": data_uri},
                                    },
                                    {
                                        "type": "text",
                                        "text": "Describe this image in detail, focusing on all visible text, UI elements, data, diagrams, and content.",
                                    },
                                ],
                            }
                        ],
                        "max_tokens": 1024,
                    }
                    resp = await client.post(
                        endpoint,
                        json=payload,
                        headers={"Authorization": f"Bearer {api_key}"},
                    )
                    if not resp.is_success:
                        logger.error(
                            "[RedisSession] Vision bridge HTTP %d for image %d: %s",
                            resp.status_code, i, resp.text[:500],
                        )
                        continue
                    result = resp.json()
                    description = (
                        result.get("choices", [{}])[0]
                        .get("message", {})
                        .get("content", "")
                    )
                    if description:
                        descriptions.append(f"[Image {i}]: {description}")
                except Exception as exc:
                    logger.error(
                        "[RedisSession] Vision bridge error for image %d: %r",
                        i, exc, exc_info=True,
                    )

        return "\n\n".join(descriptions)

    async def _maybe_archive_old_messages(self) -> None:
        """Archive oldest messages to pgvector when history exceeds 75% of context window.
        Only runs when single_chat_mode is True.
        """
        if not self.single_chat_mode or not self.current_model_name:
            return
        if not self.chat_history:
            return

        context_limit = self._get_model_context_limit(self.current_model_name)
        token_count = sum(len(m.get("content", "")) for m in self.chat_history) // 4

        if token_count <= 0.75 * context_limit:
            return

        target_tokens = int(0.50 * context_limit)
        to_archive = []
        running = token_count

        for msg in self.chat_history:  # oldest first
            if running <= target_tokens:
                break
            to_archive.append(msg)
            running -= len(msg.get("content", "")) // 4

        if not to_archive:
            return

        # Index to pgvector
        if self.agent_factory._knowledge is not None:
            from agno.knowledge.document import Document
            from datetime import datetime as _dt, timezone as _tz

            for msg in to_archive:
                try:
                    doc = Document(
                        content=msg.get("content", ""),
                        meta={
                            "user_id": self.user_id or "",
                            "source": "chat_history",
                            "role": msg.get("role", "unknown"),
                            "timestamp": msg.get(
                                "timestamp", _dt.now(_tz.utc).isoformat()
                            ),
                            "chat_id": self.chat_id,
                            "message_id": msg.get("id", ""),
                        },
                    )
                    self.agent_factory._knowledge.insert(doc)
                except Exception as exc:
                    logger.warning(
                        "[RedisSession] Failed to index message to pgvector: %s", exc
                    )

        # Mark archived in Go API
        message_ids = [m["id"] for m in to_archive if m.get("id")]
        if message_ids:
            api_url = os.getenv("API_URL", "http://localhost:8080")
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(
                        f"{api_url}/api/chats/{self.chat_id}/archive-messages",
                        json={"message_ids": message_ids},
                    )
                    if resp.status_code not in (200, 204):
                        logger.warning(
                            "[RedisSession] archive-messages returned %d",
                            resp.status_code,
                        )
            except Exception as exc:
                logger.warning(
                    "[RedisSession] Failed to call archive-messages: %s", exc
                )

        # Remove from local history
        archived_ids = {m.get("id") for m in to_archive}
        self.chat_history = [
            m for m in self.chat_history if m.get("id") not in archived_ids
        ]

    async def _repair_dangling_tool_calls(self, agent: Any) -> bool:
        """Repairs dangling tool calls in agent history."""
        # Unwrap if needed
        real_agent = agent
        if hasattr(agent, "_agent"):
            real_agent = agent._agent

        # Load history to ensure we have the latest (including the bad state)
        if hasattr(real_agent, "read_chat_history") and callable(
            real_agent.read_chat_history
        ):
            try:
                if asyncio.iscoroutinefunction(real_agent.read_chat_history):
                    await real_agent.read_chat_history()
                else:
                    real_agent.read_chat_history()
            except Exception as e:
                logger.warning("[RedisSession] Failed to read chat history: %s", e)

        if not hasattr(real_agent, "memory") or not real_agent.memory:
            return False

        messages = real_agent.memory.messages
        if not messages:
            return False

        from agno.models.message import Message

        repaired = False
        # Iterate backwards to find assistant messages with tool calls
        for i in range(len(messages) - 1, -1, -1):
            msg = messages[i]
            if msg.role == "assistant" and msg.tool_calls:
                tool_calls = msg.tool_calls
                covered_ids = set()

                # Look ahead for tool outputs
                for j in range(i + 1, len(messages)):
                    next_msg = messages[j]
                    if next_msg.role == "tool" and next_msg.tool_call_id:
                        covered_ids.add(next_msg.tool_call_id)

                # Find missing
                missing_ids = []
                for tc in tool_calls:
                    tc_id = None
                    if isinstance(tc, dict):
                        tc_id = tc.get("id")
                    elif hasattr(tc, "id"):
                        tc_id = tc.id
                    elif hasattr(tc, "tool_call_id"):
                        tc_id = tc.tool_call_id

                    if tc_id and tc_id not in covered_ids:
                        missing_ids.append(tc_id)

                if missing_ids:
                    for missing_id in missing_ids:
                        dummy_msg = Message(
                            role="tool",
                            tool_call_id=missing_id,
                            content="Tool execution interrupted. Please retry.",
                        )
                        real_agent.memory.add_message(dummy_msg)
                    repaired = True

        if repaired:
            # Save to storage so retry works (as it might reload)
            try:
                if hasattr(real_agent, "asave_session"):
                    await real_agent.asave_session()
                elif hasattr(real_agent, "save_session"):
                    real_agent.save_session()
            except Exception as e:
                logger.error("[RedisSession] Failed to save repaired history: %s", e)

        return repaired

    async def _iterate_agent_stream(self, result: Any) -> AsyncIterator[dict]:
        """Iterate over agent result stream and yield formatted events."""
        if hasattr(result, "__aiter__"):
            async for event in self._process_async_stream(result):
                yield event
        elif hasattr(result, "__iter__") and not isinstance(result, (str, bytes)):
            # Sync iterator fallback — yield each item as a text event
            for ev in result:
                chunk = str(ev) if ev is not None else ""
                if chunk:
                    yield {"type": "text", "content": chunk}
        else:
            # Single value fallback
            chunk = str(result)
            if chunk:
                yield {"type": "text", "content": chunk}

    async def _process_async_stream(self, result: Any) -> AsyncIterator[dict]:
        """Process async stream of agent events."""
        streamed_text_len = 0
        current_agent_name: str | None = (
            None  # Track current agent for context switching
        )
        last_yielded_text = ""  # Skip duplicate consecutive text chunks
        last_yielded_reasoning = ""  # Skip duplicate consecutive reasoning chunks
        accumulated_text = ""  # For APIs that send cumulative content instead of deltas (e.g. OpenCode)
        accumulated_reasoning = ""  # Same for reasoning stream

        async for ev in result:
            if self.cancel_event.is_set():
                break

            event_type = type(ev).__name__

            # Check if this is a member agent event
            agent_id = getattr(ev, "agent_id", None)
            agent_name = getattr(ev, "agent_name", None) or agent_id
            is_member_event = agent_id is not None

            # Log agent switching for multi-agent teams
            if agent_name and agent_name != current_agent_name:
                # Send separator between different agent responses to prevent text gluing
                if current_agent_name is not None:
                    yield {"type": "text", "content": "\n\n"}
                current_agent_name = agent_name
                # Reset accumulated stream state so new agent's content is not compared to previous
                accumulated_text = ""
                accumulated_reasoning = ""
                last_yielded_text = ""
                last_yielded_reasoning = ""

            # Process different event types
            async for event in self._handle_tool_call_events(
                ev, event_type, current_agent_name
            ):
                yield event

            async for event in self._handle_reasoning_event(
                ev,
                event_type,
                current_agent_name,
                accumulated_reasoning,
                last_yielded_reasoning,
            ):
                if event.get("content"):
                    accumulated_reasoning = event.get(
                        "_accumulated", accumulated_reasoning
                    )
                    last_yielded_reasoning = event.get(
                        "_last_yielded", last_yielded_reasoning
                    )
                    # Clean up internal tracking fields
                    event.pop("_accumulated", None)
                    event.pop("_last_yielded", None)
                yield event

            # RunContentCompleted arrives BEFORE learning/memory tasks finish,
            # so we use it as the "content is ready" signal to unblock DONE.
            if "RunContentCompleted" in event_type:
                yield {"type": "content_done"}

            async for event in self._handle_run_completed_event(
                ev, event_type, current_agent_name, streamed_text_len
            ):
                if event.get("type") == "text" and event.get("content"):
                    streamed_text_len += len(str(event.get("content")))
                yield event

            async for event in self._handle_workflow_event(
                ev, event_type, streamed_text_len
            ):
                if event.get("type") == "text" and event.get("content"):
                    streamed_text_len += len(str(event.get("content")))
                yield event

            async for event in self._handle_text_chunk_event(
                ev,
                event_type,
                current_agent_name,
                agent_id,
                is_member_event,
                accumulated_text,
                last_yielded_text,
                streamed_text_len,
            ):
                if event.get("content"):
                    accumulated_text = str(event.get("_accumulated", accumulated_text))
                    last_yielded_text = str(
                        event.get("_last_yielded", last_yielded_text)
                    )
                    new_len = event.get("_streamed_len")
                    if new_len is not None:
                        streamed_text_len = int(new_len)
                    # Clean up internal tracking fields
                    event.pop("_accumulated", None)
                    event.pop("_last_yielded", None)
                    event.pop("_streamed_len", None)
                yield event

            # Track active agents
            if "RunStarted" in event_type and agent_name:
                self.active_agents.add(agent_name)
                asyncio.create_task(self._broadcast_system_status())

            elif "RunCompleted" in event_type and agent_name:
                if agent_name in self.active_agents:
                    self.active_agents.discard(agent_name)
                    asyncio.create_task(self._broadcast_system_status())
                # Reset current_agent_name so next content goes to Team Lead
                current_agent_name = None

            # Handle error events
            async for event in self._handle_agent_error_event(ev, event_type):
                yield event

    def _extract_tool_data(self, tool_obj: Any) -> dict:
        """Extract tool data from various formats (dict or object)."""
        if not tool_obj:
            return {
                "id": None,
                "name": "unknown",
                "arguments": {},
                "result": None,
                "status": "unknown",
            }

        if isinstance(tool_obj, dict):
            tool_name = tool_obj.get("tool_name") or tool_obj.get("name") or "unknown"
            tool_args = tool_obj.get("tool_args") or tool_obj.get("arguments") or {}
            tool_result = tool_obj.get("result")
            tool_id = (
                tool_obj.get("tool_call_id")
                or tool_obj.get("call_id")
                or tool_obj.get("id")
            )
        else:
            tool_name = getattr(tool_obj, "tool_name", None) or getattr(
                tool_obj, "name", "unknown"
            )
            tool_args = getattr(tool_obj, "tool_args", {})
            tool_result = getattr(tool_obj, "result", None)
            tool_id = (
                getattr(tool_obj, "tool_call_id", None)
                or getattr(tool_obj, "call_id", None)
                or getattr(tool_obj, "id", None)
            )

        return {
            "id": tool_id,
            "name": tool_name,
            "arguments": tool_args,
            "result": tool_result,
            "status": "completed",
        }

    async def _handle_tool_call_events(
        self, ev: Any, event_type: str, current_agent_name: str | None
    ) -> AsyncIterator[dict]:
        """Handle tool call started and completed events."""
        # ToolCallStarted
        if "ToolCallStarted" in event_type:
            tool_obj = ev.tool if ev.tool else None

            if tool_obj:
                if isinstance(tool_obj, dict):
                    tool_name = (
                        tool_obj.get("tool_name") or tool_obj.get("name") or "unknown"
                    )
                    tool_args = (
                        tool_obj.get("tool_args") or tool_obj.get("arguments") or {}
                    )
                    tool_id = (
                        tool_obj.get("tool_call_id")
                        or tool_obj.get("call_id")
                        or tool_obj.get("id")
                    )
                else:
                    tool_name = getattr(tool_obj, "tool_name", None) or getattr(
                        tool_obj, "name", "unknown"
                    )
                    tool_args = getattr(tool_obj, "tool_args", {})
                    tool_id = (
                        getattr(tool_obj, "tool_call_id", None)
                        or getattr(tool_obj, "call_id", None)
                        or getattr(tool_obj, "id", None)
                    )
            else:
                tool_name = "unknown"
                tool_args = {}
                tool_id = None

            tool_data = {
                "type": "tool_call",
                "tool": {
                    "id": tool_id,
                    "name": tool_name,
                    "arguments": tool_args,
                    "status": "running",
                },
            }
            if current_agent_name:
                tool_data["agent_name"] = current_agent_name
            yield tool_data

        # ToolCallCompleted
        elif "ToolCallCompleted" in event_type:
            if hasattr(ev, "tool") and ev.tool:
                tool_dict = self._extract_tool_data(ev.tool)


                # Accumulate tool result for agent context
                self._accumulated_tool_results.append(tool_dict)

                tool_data = {"type": "tool_call", "tool": tool_dict}
                if current_agent_name:
                    tool_data["agent_name"] = current_agent_name
                yield tool_data
                # Add separator after tool call to prevent text gluing
                yield {"type": "text", "content": "\n\n"}

    async def _handle_reasoning_event(
        self,
        ev: Any,
        event_type: str,
        current_agent_name: str | None,
        accumulated_reasoning: str,
        last_yielded_reasoning: str,
    ) -> AsyncIterator[dict]:
        """Handle reasoning/thinking events from various sources."""
        captured_reasoning = self._extract_reasoning_content(ev, event_type)

        if captured_reasoning:
            # Handle cumulative stream: if chunk extends previous, yield only the new suffix
            if captured_reasoning.startswith(accumulated_reasoning) and len(
                captured_reasoning
            ) > len(accumulated_reasoning):
                to_yield = captured_reasoning[len(accumulated_reasoning) :]
                new_accumulated = captured_reasoning
            elif captured_reasoning == accumulated_reasoning:
                # Content hasn't changed, nothing new to yield
                to_yield = ""
                new_accumulated = accumulated_reasoning
            else:
                # Content changed but not cumulative - use as-is
                to_yield = captured_reasoning
                new_accumulated = captured_reasoning

            if to_yield and to_yield != last_yielded_reasoning:
                reasoning_data = {
                    "type": "reasoning",
                    "content": to_yield,
                    "agent_name": current_agent_name,
                    "_accumulated": new_accumulated,
                    "_last_yielded": to_yield,
                }
                yield reasoning_data

    def _extract_reasoning_content(self, ev: Any, event_type: str) -> str | None:
        """Extract reasoning content from various event formats."""
        if hasattr(ev, "reasoning_content") and ev.reasoning_content:
            return ev.reasoning_content

        if hasattr(ev, "thinking_content") and ev.thinking_content:
            return ev.thinking_content

        if hasattr(ev, "thinking") and ev.thinking:
            return ev.thinking

        if ("Reasoning" in event_type or "Thinking" in event_type) and hasattr(
            ev, "content"
        ):
            if ev.content:
                return ev.content

        if hasattr(ev, "delta") and "Reasoning" in event_type:
            return ev.delta

        return None

    async def _handle_run_completed_event(
        self,
        ev: Any,
        event_type: str,
        current_agent_name: str | None,
        streamed_text_len: int,
    ) -> AsyncIterator[dict]:
        """Handle RunCompletedEvent - contains full message content."""
        if "RunCompleted" not in event_type:
            return

        val = getattr(ev, "content", None)
        if val:
            self._last_run_completed_content = str(val)
        if val and len(str(val)) > streamed_text_len:
            remainder = str(val)[streamed_text_len:]
            if remainder.strip():
                # Check if it looks like reasoning
                if remainder.strip().startswith(
                    "My thinking process"
                ) or remainder.strip().startswith("Thinking Process:"):
                    yield {
                        "type": "reasoning",
                        "content": remainder,
                        "agent_name": current_agent_name,
                    }
                else:
                    yield {
                        "type": "text",
                        "content": remainder,
                        "agent_name": current_agent_name,
                    }

    async def _handle_workflow_event(
        self, ev: Any, event_type: str, streamed_text_len: int
    ) -> AsyncIterator[dict]:
        """Handle workflow events (StepCompletedEvent and WorkflowCompletedEvent)."""
        # StepCompletedEvent contains the output of each step (agent)
        if "StepCompletedEvent" in event_type:
            # Get content from the event
            val = getattr(ev, "content", None)

            # Also check step_response for nested content
            step_response = getattr(ev, "step_response", None)
            if step_response and not val:
                val = getattr(step_response, "content", None)

            if val and str(val).strip():
                content = str(val)
                # Skip yielding content here to avoid duplication with RunContentEvent
                # RunContentEvent + RunCompletedEvent already handle the streaming

        # WorkflowCompletedEvent contains the final aggregated result
        if "WorkflowCompletedEvent" in event_type:
            val = getattr(ev, "content", None)
            if val and str(val).strip():
                content = str(val)
                # Only yield if we haven't already streamed this content
                if len(content) > streamed_text_len:
                    remainder = content[streamed_text_len:]
                    if remainder.strip():
                        yield {"type": "text", "content": remainder}

    async def _handle_text_chunk_event(
        self,
        ev: Any,
        event_type: str,
        current_agent_name: str | None,
        agent_id: Any,
        is_member_event: bool,
        accumulated_text: str,
        last_yielded_text: str,
        streamed_text_len: int,
    ) -> AsyncIterator[dict]:
        """Handle text content streaming events (deltas only)."""
        # Exclude RunContentCompletedEvent: it contains "RunContentEvent" in its name
        # but carries full aggregated content; we must not re-send it to avoid duplication.
        if not (
            (
                "RunContentEvent" in event_type
                and "RunContentCompleted" not in event_type
            )
            or "ModelContentEvent" in event_type
            or "TextDeltaEvent" in event_type
            or "TextEvent" in event_type
        ):
            return

        val = None
        if hasattr(ev, "content"):
            val = ev.content
        elif hasattr(ev, "text"):
            val = ev.text
        elif hasattr(ev, "delta"):
            val = ev.delta

        chunk = str(val) if val is not None else ""

        if (
            chunk.startswith("```tool_outputs")
            or chunk.startswith('{"delegate_task_to_member')
            or "delegate_task_to_member_response" in chunk
        ):
            return

        # Get the current reasoning to avoid yielding reasoning as text
        captured_reasoning = self._extract_reasoning_content(ev, event_type)
        if chunk == captured_reasoning:
            return

        # Handle cumulative stream: if chunk extends previous, yield only the new suffix
        if chunk.startswith(accumulated_text) and len(chunk) > len(accumulated_text):
            to_yield = chunk[len(accumulated_text) :]
            new_accumulated = chunk
        elif chunk == accumulated_text:
            # Content hasn't changed, nothing new to yield
            to_yield = ""
            new_accumulated = accumulated_text
        else:
            # Content changed but not cumulative - use as-is
            to_yield = chunk
            new_accumulated = chunk

        if to_yield and to_yield != last_yielded_text:
            # Use current_agent_name to detect if we're in a member context
            is_member_context = (
                current_agent_name is not None
                and current_agent_name
                not in ("Team Lead", "Team Leader", "Development Team")
            )

            new_streamed_len = streamed_text_len + len(to_yield)
            if is_member_event or is_member_context:
                event = {
                    "type": "member_response",
                    "content": to_yield,
                    "agent_id": agent_id or current_agent_name,
                    "agent_name": agent_id or current_agent_name,
                    "_accumulated": new_accumulated,
                    "_last_yielded": to_yield,
                    "_streamed_len": new_streamed_len,
                }
            else:
                event = {
                    "type": "text",
                    "content": to_yield,
                    "agent_name": current_agent_name,
                    "_accumulated": new_accumulated,
                    "_last_yielded": to_yield,
                    "_streamed_len": new_streamed_len,
                }
            yield event

    async def _handle_agent_error_event(
        self, ev: Any, event_type: str
    ) -> AsyncIterator[dict]:
        """Handle RunErrorEvent from Agno agent."""
        if "RunError" not in event_type:
            return

        error_content = getattr(ev, "content", None)
        error_message = "Agent execution failed"
        error_code = "agent_error"
        error_details: dict[str, Any] = {}

        # Try to parse error content if it's JSON
        if error_content:
            try:
                if isinstance(error_content, str):
                    error_data = json.loads(error_content)
                else:
                    error_data = error_content

                # Extract error info from Agno's error format
                if isinstance(error_data, dict):
                    error_obj = error_data.get("error", {})
                    if isinstance(error_obj, dict):
                        error_message = error_obj.get("message", error_message)
                        error_code = error_obj.get("code", error_code)
                        error_status = error_obj.get("status", "")
                        if error_status:
                            error_code = error_status.lower().replace("_", "-")
                        error_details = {
                            "error_type": type(ev).__name__,
                            "agent_id": getattr(ev, "agent_id", None),
                            "run_id": getattr(ev, "run_id", None),
                            "raw_error": str(error_content)[:500],  # Limit size
                        }
            except Exception:
                # If parsing fails, use raw content as message
                error_message = str(error_content)[:500]
                error_details = {
                    "error_type": type(ev).__name__,
                    "raw_error": str(error_content)[:500],
                }

        # Detect rate limit errors
        raw_content = str(error_content or "").lower()
        is_rate_limited = (
            "rate limit" in raw_content
            or "ratelimit" in raw_content
            or "429" in raw_content
            or "FreeUsageLimitError" in str(error_content)
            or "RateLimitError" in str(error_content)
        )
        if is_rate_limited:
            error_code = "rate_limited"

        logger.error(
            "[RedisSession] RunErrorEvent received: %s",
            error_message,
            extra={
                "chat_id": self.chat_id,
                "user_id": self.user_id,
                "error_code": error_code,
                "error_details": error_details,
            },
        )

        # Yield error event that will be handled in handle_user_message
        yield {
            "type": "error",
            "message": error_message,
            "code": error_code,
            "http": 429 if is_rate_limited else 500,
            "details": error_details,
        }
