import asyncio
import json
import logging
import os
import uuid
from typing import Any

import redis.asyncio as redis

from src.agents.factory import AgentFactory
from src.constants import Redis
from src.server.models import Frame, Op
from src.server.redis_client import make_redis_client
from src.server.redis_session import RedisSession
from src.server.utils import make_error

logger = logging.getLogger(__name__)


class RedisWorker:
    def __init__(self, agent_factory: AgentFactory, go_ws: Any = None):
        self.agent_factory = agent_factory
        self.go_ws = go_ws  # GoWSClient; None → Redis-only delivery
        self.redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        self.redis: redis.Redis | None = None
        self.pubsub: Any | None = None
        self.running = False
        self._tasks: set[asyncio.Task] = set()

        # Task registry (instance variable)
        self.active_tasks: dict[str, asyncio.Task] = {}
        # Long-running background agent tasks, keyed by task_id. Kept separate
        # from active_tasks so a chat turn's cleanup never kills a background
        # task, and so STOP can target a specific task by id.
        self.active_task_runs: dict[str, asyncio.Task] = {}
        # request_id currently being processed per chat — lets us tell a genuine
        # new turn (debounce-cancel) apart from a hub re-publish of the same turn
        # (ignore, so we don't kill the in-flight generation).
        self.active_request_ids: dict[str, str] = {}

        # Pending client tool results: call_id -> Future[str]
        self.pending_client_tool_results: dict[str, asyncio.Future] = {}

    async def start(self):
        """Connect to Redis with exponential backoff retry, subscribe, then launch message loop."""
        safe_url = self.redis_url
        if "@" in safe_url:
            safe_url = f"{safe_url.split('@')[-1]}"

        logger.warning("[RedisWorker] Starting... URL: ...@%s", safe_url)
        self.running = True

        base_delay = 2.0
        max_delay = 60.0
        delay = base_delay

        while self.running:
            try:
                self.redis = make_redis_client(self.redis_url)
                self.pubsub = self.redis.pubsub()

                await self.pubsub.psubscribe(Redis.CHANNEL_REQUEST.replace("{}", "*"))
                await self.pubsub.subscribe(
                    Redis.CHANNEL_JULES_MONITOR,
                    Redis.CHANNEL_STORE_FACTS,
                    Redis.CHANNEL_DEFERRED_ACTION_RESULT,
                )

                # Wait for subscription confirmations with get_message() to avoid
                # blocking aclose() when breaking from async-for pubsub.listen()
                confirmed = 0
                deadline = asyncio.get_event_loop().time() + 5.0
                while confirmed < 4 and asyncio.get_event_loop().time() < deadline:
                    message = await self.pubsub.get_message(
                        ignore_subscribe_messages=False, timeout=1.0
                    )
                    if message and message["type"] in ("psubscribe", "subscribe"):
                        confirmed += 1
                        logger.info(
                            "[RedisWorker] Subscription confirmed: %s",
                            message.get("channel") or message.get("pattern"),
                        )

                if confirmed < 3:
                    logger.warning(
                        "[RedisWorker] Subscriptions may not be fully ready (%d/3), proceeding anyway",
                        confirmed,
                    )

                logger.warning(
                    "[RedisWorker] Successfully subscribed to %s, %s, %s",
                    Redis.CHANNEL_REQUEST.format("*"),
                    Redis.CHANNEL_JULES_MONITOR,
                    Redis.CHANNEL_STORE_FACTS,
                )

                # Launch message loop as a background task so start() returns immediately
                asyncio.create_task(self._run_loop())
                return

            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(
                    "[RedisWorker] Connection failed: %s, retrying in %.1fs...",
                    e,
                    delay,
                )
                if not self.running:
                    return
                await asyncio.sleep(delay)
                delay = min(delay * 2, max_delay)

    async def _run_loop(self):
        """Background task: run message loop with exponential backoff reconnect."""
        base_delay = 2.0
        max_delay = 60.0
        delay = base_delay

        while self.running:
            try:
                await self._process_messages()
                logger.error("[RedisWorker] Message loop exited, reconnecting in %.1fs...", delay)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error("[RedisWorker] Failed: %s, reconnecting in %.1fs...", e, delay, exc_info=True)

            if not self.running:
                break

            await asyncio.sleep(delay)
            delay = min(delay * 2, max_delay)

            # Reconnect pubsub on error. Close the old client/pubsub first so we
            # don't leak connections toward Redis maxclients on every retry, and
            # bound the (re)subscribe so an unreachable Redis can't wedge the loop.
            await self._close_connection()
            try:
                self.redis = make_redis_client(self.redis_url)
                self.pubsub = self.redis.pubsub()
                await asyncio.wait_for(
                    self.pubsub.psubscribe(Redis.CHANNEL_REQUEST.replace("{}", "*")),
                    timeout=15,
                )
                await asyncio.wait_for(
                    self.pubsub.subscribe(
                        Redis.CHANNEL_JULES_MONITOR,
                        Redis.CHANNEL_STORE_FACTS,
                        Redis.CHANNEL_DEFERRED_ACTION_RESULT,
                    ),
                    timeout=15,
                )
                delay = base_delay
            except (Exception, asyncio.TimeoutError) as e:
                logger.warning("[RedisWorker] Reconnect failed: %s, retrying in %.1fs...", e, delay)

    async def _close_connection(self):
        """Close pubsub + redis client, ignoring errors (used before reconnect)."""
        if self.pubsub:
            try:
                await self.pubsub.aclose()
            except Exception:
                pass
        if self.redis:
            try:
                await self.redis.aclose()
            except Exception:
                pass

    async def _process_messages(self):
        """Process messages from Redis pub/sub."""
        if not self.pubsub:
            logger.error("[RedisWorker] PubSub not initialized")
            return

        try:
            async for message in self.pubsub.listen():
                if not self.running:
                    break
                if message:
                    await self._handle_message(message)
        except Exception as e:
            # Expected on transient Redis disconnects — _run_loop will reconnect.
            logger.warning("[RedisWorker] Message loop interrupted: %s", e)

    async def _handle_message(self, message: dict):
        # Normalize channel: redis-py may return bytes or str; psubscribe uses "pattern"
        channel = message.get("channel") or message.get("pattern") or ""
        if isinstance(channel, bytes):
            channel = channel.decode("utf-8", errors="replace")
        data = message.get("data")

        if not channel or not data:
            return

        # Normalize data: redis-py may return bytes or int (subscriber count)
        if isinstance(data, bytes):
            data = data.decode("utf-8", errors="replace")
        elif isinstance(data, int):
            # Skip subscriber count messages
            return

        # NOTE: Global client_tool_result handling removed - now per-session in RedisSession

        # Case: Deferred client-action result (queued action drained by device
        # after the originating run ended) → deliver a follow-up message.
        if channel == Redis.CHANNEL_DEFERRED_ACTION_RESULT:
            task = asyncio.create_task(self._handle_deferred_action_result(data))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
            return

        # Case: Chat Request (pattern match)
        # channel: chat:request:<chat_id>
        parts = channel.split(":")
        if len(parts) >= 3 and parts[0] == "chat" and parts[1] == "request":
            chat_id = parts[2]
            logger.debug(
                "[RedisWorker] RECEIVED %s (data type=%s)",
                Redis.CHANNEL_REQUEST.format(chat_id),
                type(data).__name__,
            )
            task = asyncio.create_task(self._process_request(chat_id, data))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    async def _handle_deferred_action_result(self, raw_data: str):
        """Deliver a follow-up for a queued client action that the device
        executed after the originating run had already ended."""
        try:
            payload = json.loads(raw_data)
        except (json.JSONDecodeError, TypeError) as exc:
            logger.warning("[RedisWorker] Bad deferred action result payload: %s", exc)
            return

        source = payload.get("source")
        result = payload.get("result") or ""
        context = payload.get("delivery_context") or {}
        if not source:
            logger.warning("[RedisWorker] Deferred action result missing source")
            return

        from src.server.delivery import DeliveryRegistry

        handler = DeliveryRegistry.get(source)
        if not handler:
            logger.warning(
                "[RedisWorker] No delivery handler for deferred result source=%s", source
            )
            return

        try:
            await handler.deliver(result, context)
            logger.info(
                "[RedisWorker] Delivered deferred action follow-up via source=%s", source
            )
        except Exception as exc:
            logger.error(
                "[RedisWorker] Failed to deliver deferred action follow-up: %s",
                exc,
                exc_info=True,
            )

    async def _start_task_run(self, chat_id: str, frame: Frame):
        """Launch a long-running background agent task (detached from the turn).

        Registered in active_task_runs by task_id so a chat turn's cleanup never
        kills it and STOP can target it by id.
        """
        payload = dict(frame.payload or {})
        task_id = str(payload.get("task_id") or uuid.uuid4())
        payload["task_id"] = task_id
        payload.setdefault("chat_id", chat_id)
        logger.info("[RedisWorker] TASK_START %s (chat %s)", task_id, chat_id)
        self._launch_task_run(task_id, payload)

    def _launch_task_run(self, task_id: str, payload: dict) -> None:
        """Spawn a detached build_and_run coroutine and register it by task_id.

        Shared by the TASK_START path and the boot reconciler. Skips if a run
        for this task_id is already active (guards against a duplicate relaunch).
        """
        if task_id in self.active_task_runs:
            logger.info("[RedisWorker] Task run %s already active, skipping", task_id)
            return

        from src.server.task_runner import build_and_run

        async def task_wrapped():
            try:
                await build_and_run(
                    agent_factory=self.agent_factory,
                    redis=self.redis,
                    go_ws=self.go_ws,
                    redis_worker=self,
                    payload=payload,
                )
            except asyncio.CancelledError:
                logger.warning("[RedisWorker] Task run %s cancelled", task_id)
                raise
            except Exception as e:  # noqa: BLE001
                logger.error(
                    "[RedisWorker] Task run %s error: %s", task_id, e, exc_info=True
                )
            finally:
                if self.active_task_runs.get(task_id) is current_task:
                    del self.active_task_runs[task_id]
                    logger.info("[RedisWorker] Cleaned up task run %s", task_id)

        # Detached: do NOT await — the run outlives this request handler.
        current_task = asyncio.create_task(task_wrapped())
        self.active_task_runs[task_id] = current_task

    async def reconcile_unfinished_tasks(self) -> None:
        """On boot, relaunch tasks left unfinished by a prior worker/process.

        Pulls the unfinished set from the Go API (single DB owner) and resumes
        each from its persisted step cursor instead of re-planning. A task a live
        worker is actively progressing is filtered out server-side by staleness,
        and _launch_task_run additionally skips any task_id already active here.
        """
        import httpx

        go_url = os.getenv("GO_API_URL", "http://localhost:8080").rstrip("/")
        token = os.getenv("WORKER_TOKEN", "")
        headers = {"X-Worker-Token": token} if token else {}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{go_url}/internal/tasks/unfinished", headers=headers
                )
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:  # noqa: BLE001
            logger.warning("[RedisWorker] reconcile fetch failed: %s", exc)
            return

        tasks = data.get("tasks") if isinstance(data, dict) else None
        relaunched = 0
        for t in tasks or []:
            tid = str(t.get("task_id") or "")
            if not tid or tid in self.active_task_runs:
                continue
            try:
                self._relaunch_task_run(t)
                relaunched += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "[RedisWorker] failed to relaunch task %s: %s", tid, exc
                )
        if relaunched:
            logger.info(
                "[RedisWorker] reconciled %d unfinished task(s)", relaunched
            )

    def _relaunch_task_run(self, task: dict) -> None:
        """Build a resume payload from a reconcile row and launch it."""
        task_id = str(task.get("task_id") or "")
        payload = {
            "task_id": task_id,
            "user_id": task.get("user_id") or "",
            "chat_id": task.get("chat_id") or task_id,
            "goal": task.get("goal") or "",
            "agent_type": "nomi",
            "resume_state": {
                "plan": task.get("plan") or [],
                "current_step": task.get("current_step") or 0,
                "attempt": task.get("attempt") or 0,
                "pending_approval": task.get("pending_approval"),
                "last_seq": task.get("last_seq") or 0,
                "guidance": task.get("guidance") or [],
                "status": task.get("status"),
            },
        }
        self._launch_task_run(task_id, payload)

    async def _process_request(self, chat_id: str, raw_data: str):
        """Process the request logic."""
        # Use chat_id as task key.
        # If we need per-message cancellation, we'd need message_id, but usually we cancel the whole generation for the chat.

        try:
            payload = json.loads(raw_data)
            frame = Frame(**payload)

            # Validate frame
            if frame.op == Op.PING:
                return

            if frame.op == Op.STOP:
                logger.info("[RedisWorker] Received STOP for chat %s", chat_id)
                # A STOP carrying a task_id targets a specific background task run.
                stop_task_id = (frame.payload or {}).get("task_id")
                if stop_task_id and stop_task_id in self.active_task_runs:
                    logger.info("[RedisWorker] Cancelling task run %s", stop_task_id)
                    self.active_task_runs[stop_task_id].cancel()
                    return

                # Set cancellation flag in Redis (expires in 60s)
                if self.redis:
                    await self.redis.set(
                        Redis.CHANNEL_STOP.format(chat_id), "true", ex=60
                    )

                if chat_id in self.active_tasks:
                    self.active_tasks[chat_id].cancel()
                    # We don't remove it here immediately, let the task finish/cleanup
                return

            if frame.op == Op.TASK_START:
                await self._start_task_run(chat_id, frame)
                return

            if frame.op not in (Op.MESSAGE, Op.COMMAND_CALL):
                logger.debug(
                    "[RedisWorker] Ignoring unsupported op: %s for chat %s",
                    frame.op,
                    chat_id,
                )
                return

            # Implement logic to handle session
            frame_payload = frame.payload or {}
            user_id = frame_payload.get("user_id") or frame_payload.get("sender")
            request_id = frame_payload.get("request_id") or frame_payload.get(
                "message_id"
            )

            # A hub re-publish of the same turn carries the same request_id. If that
            # turn is already running, ignore the duplicate — cancelling and
            # restarting would kill an in-flight generation that is about to reply.
            if (
                request_id
                and chat_id in self.active_tasks
                and self.active_request_ids.get(chat_id) == request_id
            ):
                logger.info(
                    "[RedisWorker] Ignoring duplicate re-publish for chat %s request %s",
                    chat_id,
                    request_id,
                )
                return

            # For a genuine new MESSAGE, cancel the previous task (debounce/restart).
            if chat_id in self.active_tasks:
                logger.info(
                    "[RedisWorker] Cancelling existing task for chat %s", chat_id
                )
                self.active_tasks[chat_id].cancel()
                # Ideally, we should wait for it to cleanup, but for now we just overwrite in dict
                # and let the old task die in background.

            session = RedisSession(
                agent_factory=self.agent_factory,
                session_id=chat_id,
                user_id=user_id,
                chat_id=chat_id,
                redis_worker=self,
                go_ws=self.go_ws,
            )

            # Create new task
            # We wrap it to ensure cleanup from registry
            async def wrapped_task():
                try:
                    await session.handle_frame(frame)
                except asyncio.CancelledError:
                    # IMPORTANT: Explicitly catch and re-raise CancelledError
                    # This ensures the task stops immediately when cancelled
                    logger.warning(
                        "[RedisWorker] Task %s was cancelled correctly.", chat_id
                    )
                    raise  # Re-raise to propagate cancellation up
                except Exception as e:
                    # Make sure we don't accidentally catch CancelledError here
                    if isinstance(e, asyncio.CancelledError):
                        logger.warning(
                            "[RedisWorker] Task %s cancelled (caught as Exception)",
                            chat_id,
                        )
                        raise
                    logger.error(
                        "[RedisWorker] Task error for chat %s: %s",
                        chat_id,
                        e,
                        exc_info=True,
                    )
                    # Try to send error frame to client
                    await self._send_error_frame(
                        session=session,
                        chat_id=chat_id,
                        error_code="task_failed",
                        error_message=f"Task processing failed: {str(e)}",
                        error_details={
                            "error_type": type(e).__name__,
                            "chat_id": chat_id,
                            "trace_id": getattr(frame, "trace_id", None),
                        },
                    )
                finally:
                    # Cleanup: Remove from active tasks registry
                    if self.active_tasks.get(chat_id) == current_task:
                        del self.active_tasks[chat_id]
                        # request_id is only registered for MESSAGE frames; for
                        # command_call frames it stays absent. Guard the delete
                        # so cleanup doesn't blow up with a KeyError.
                        if (
                            request_id
                            and self.active_request_ids.get(chat_id) == request_id
                        ):
                            del self.active_request_ids[chat_id]
                        logger.info(
                            "[RedisWorker] Cleaned up task registry for chat %s",
                            chat_id,
                        )
                    # NOTE: the chat:req:{request_id} idempotency guard is left to
                    # expire on its short TTL rather than deleted here — deleting it
                    # would be unsafe across multiple worker processes (a duplicate
                    # that hit the guard must not release the original's key).

            # We need reference to current_task inside, but we can't get it before creation.
            # So we create it first.
            t = asyncio.create_task(wrapped_task())
            current_task = t
            self.active_tasks[chat_id] = t
            if request_id:
                self.active_request_ids[chat_id] = request_id

            await t

        except json.JSONDecodeError as e:
            logger.error(
                "[RedisWorker] Failed to decode JSON for chat %s: %s",
                chat_id,
                e,
                exc_info=True,
            )
            # Try to send error frame if we have user_id
            await self._send_parse_error_frame(raw_data, chat_id, e)
        except asyncio.CancelledError:
            pass  # Expected
        except Exception as e:
            logger.error(
                "[RedisWorker] Error processing request for %s: %s",
                chat_id,
                e,
                exc_info=True,
            )
            # Try to send error frame if possible
            await self._send_parse_error_frame(raw_data, chat_id, e)

    async def _send_error_frame(
        self,
        session: RedisSession,
        chat_id: str,
        error_code: str,
        error_message: str,
        error_details: dict[str, Any] | None = None,
        http_status: int = 500,
    ) -> None:
        """Send an error frame to the client via Redis session.

        Args:
            session: The RedisSession instance to use for sending
            chat_id: The chat ID for the error frame
            error_code: The error code string
            error_message: The human-readable error message
            error_details: Optional additional error details
            http_status: HTTP status code (default 500)
        """
        try:
            trace_id = error_details.get("trace_id") if error_details else None
            error_frame = make_error(
                session.next_id,
                error_code,
                chat_id,
                error_message,
                http=http_status,
                details=error_details or {},
                trace_id=trace_id,
            )
            await session._send_frame(error_frame)
        except Exception as send_err:
            logger.error(
                "[RedisWorker] Failed to send error frame for chat %s: %s",
                chat_id,
                send_err,
                exc_info=True,
            )

    async def _send_parse_error_frame(
        self, raw_data: str, chat_id: str, error: Exception
    ) -> None:
        """Send an error frame when JSON parsing fails.

        Attempts to extract user_id from the raw data to send the error to the right channel.

        Args:
            raw_data: The raw request data that failed to parse
            chat_id: The chat ID
            error: The exception that occurred during parsing
        """
        if not self.redis:
            return

        try:
            raw_payload = json.loads(raw_data)
            frame_payload = raw_payload.get("payload", {})
            user_id = frame_payload.get("user_id") or frame_payload.get("sender")
            trace_id = raw_payload.get("trace_id")
            if user_id:
                error_code = (
                    "parse_failed"
                    if isinstance(error, json.JSONDecodeError)
                    else "worker_error"
                )
                error_frame = make_error(
                    0,
                    error_code,
                    chat_id,
                    f"Failed to parse request JSON: {str(error)}"
                    if isinstance(error, json.JSONDecodeError)
                    else f"Worker processing failed: {str(error)}",
                    http=400 if isinstance(error, json.JSONDecodeError) else 500,
                    details={
                        "error_type": type(error).__name__,
                        "chat_id": chat_id,
                        "trace_id": trace_id,
                    },
                    trace_id=trace_id,
                )
                channel = Redis.CHANNEL_USER.format(user_id)
                await self.redis.publish(channel, json.dumps(error_frame.marshal()))
        except (json.JSONDecodeError, TypeError, ValueError) as e:
            logger.debug("[RedisWorker] Cannot extract user_id from malformed data: %s", e)
        except Exception as e:
            logger.warning("[RedisWorker] Failed to send parse error frame: %s", e)
