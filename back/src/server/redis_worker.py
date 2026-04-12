import asyncio
import json
import logging
import os
from typing import Any

import redis.asyncio as redis

from src.agents.factory import AgentFactory
from src.constants import Redis
from src.server.models import Frame, Op
from src.server.redis_session import RedisSession
from src.server.utils import make_error

logger = logging.getLogger(__name__)


class RedisWorker:
    def __init__(self, agent_factory: AgentFactory):
        self.agent_factory = agent_factory
        self.redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        self.redis: redis.Redis | None = None
        self.pubsub: Any | None = None
        self.running = False
        self._tasks: set[asyncio.Task] = set()

        # Task registry (instance variable)
        self.active_tasks: dict[str, asyncio.Task] = {}

        # Pending client tool results: call_id -> Future[str]
        self.pending_client_tool_results: dict[str, asyncio.Future] = {}

    async def start(self):
        """Start the Redis worker with exponential backoff retry."""
        # Mask password in logs
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
                self.redis = redis.from_url(self.redis_url, decode_responses=True)
                self.pubsub = self.redis.pubsub()

                # Subscribe to chat requests, store_facts, jules monitoring
                # NOTE: We do NOT subscribe to a global client_tool_result channel anymore.
                # Instead, each session subscribes to its own per-session channel.
                await self.pubsub.psubscribe(Redis.CHANNEL_REQUEST.replace("{}", "*"))
                await self.pubsub.subscribe(
                    Redis.CHANNEL_JULES_MONITOR,
                    Redis.CHANNEL_STORE_FACTS,
                )

                # Wait for subscription confirmations using get_message() with timeout
                # to avoid aclose() hang when breaking out of async for pubsub.listen()
                confirmed = 0
                deadline = asyncio.get_event_loop().time() + 5.0
                while confirmed < 3 and asyncio.get_event_loop().time() < deadline:
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
                delay = base_delay  # reset on success
                await self._process_messages()
                # If _process_messages returns normally, Redis disconnected
                logger.error("[RedisWorker] Message loop exited, reconnecting in %.1fs...", delay)

            except Exception as e:
                logger.error(
                    "[RedisWorker] Failed: %s, retrying in %.1fs...",
                    e,
                    delay,
                    exc_info=True,
                )

            if not self.running:
                break

            await asyncio.sleep(delay)
            delay = min(delay * 2, max_delay)

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
            logger.error("[RedisWorker] Message processing error: %s", e, exc_info=True)

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

        # Case: Chat Request (pattern match)
        # channel: chat:request:<chat_id>
        parts = channel.split(":")
        if len(parts) >= 3 and parts[0] == "chat" and parts[1] == "request":
            chat_id = parts[2]
            logger.info(
                "[RedisWorker] RECEIVED %s (data type=%s)",
                Redis.CHANNEL_REQUEST.format(chat_id),
                type(data).__name__,
            )
            task = asyncio.create_task(self._process_request(chat_id, data))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

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
                # Set cancellation flag in Redis (expires in 60s)
                if self.redis:
                    await self.redis.set(
                        Redis.CHANNEL_STOP.format(chat_id), "true", ex=60
                    )

                if chat_id in self.active_tasks:
                    self.active_tasks[chat_id].cancel()
                    # We don't remove it here immediately, let the task finish/cleanup
                return

            if frame.op != Op.MESSAGE:
                logger.warning(
                    "[RedisWorker] Ignoring non-MESSAGE op: %s for chat %s",
                    frame.op,
                    chat_id,
                )
                return

            # For MESSAGE, we cancel previous task if any (debouncing/restart)
            if chat_id in self.active_tasks:
                logger.info(
                    "[RedisWorker] Cancelling existing task for chat %s", chat_id
                )
                self.active_tasks[chat_id].cancel()
                # Wait a bit? Or just overwrite.
                # Ideally, we should wait for it to cleanup, but for now we just overwrite in dict
                # and let the old task die in background.

            # Implement logic to handle session
            frame_payload = frame.payload or {}
            user_id = frame_payload.get("user_id") or frame_payload.get("sender")

            session = RedisSession(
                agent_factory=self.agent_factory,
                session_id=chat_id,
                user_id=user_id,
                chat_id=chat_id,
                redis_worker=self,
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
                        logger.info(
                            "[RedisWorker] Cleaned up task registry for chat %s",
                            chat_id,
                        )

            # We need reference to current_task inside, but we can't get it before creation.
            # So we create it first.
            t = asyncio.create_task(wrapped_task())
            current_task = t
            self.active_tasks[chat_id] = t

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
