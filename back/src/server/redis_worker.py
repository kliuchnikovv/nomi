import asyncio
import json
import logging
import os
import redis.asyncio as redis
from typing import Dict


from src.server.models import Frame, Op
from src.server.redis_session import RedisSession
from src.agents.factory import AgentFactory
from src.tools.jules import JulesTools
from src.tools.task_manager import TaskManagementTool

logger = logging.getLogger(__name__)


class RedisWorker:
    def __init__(self, agent_factory: AgentFactory):
        self.agent_factory = agent_factory
        self.redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        self.redis = None
        self.pubsub = None
        self.running = False
        self._tasks = set()

        # Tools for async Jules monitoring
        jules_api_key = os.getenv("JULES_API_KEY")
        self.jules_tool = JulesTools(api_key=jules_api_key) if jules_api_key else None
        self.task_tool = TaskManagementTool()
        # Task registry (instance variable)
        self.active_tasks: Dict[str, asyncio.Task] = {}

    async def start(self):
        """Start the Redis worker."""
        # Mask password in logs
        safe_url = self.redis_url
        if "@" in safe_url:
            safe_url = f"{safe_url.split('@')[-1]}"

        logger.warning(f"[RedisWorker] Starting... URL: ...@{safe_url}")
        self.running = True

        try:
            self.redis = redis.from_url(self.redis_url, decode_responses=True)
            self.pubsub = self.redis.pubsub()

            # Subscribe to chat requests AND jules monitoring events
            await self.pubsub.psubscribe("chat:request:*")
            await self.pubsub.subscribe("jules:monitor")

            logger.warning(
                "[RedisWorker] Successfully subscribed to chat:request:* and jules:monitor"
            )

            asyncio.create_task(self._process_messages())

        except Exception as e:
            logger.error(f"[RedisWorker] Failed to start: {e}", exc_info=True)
            # Retry logic could go here

    async def stop(self):
        """Stop the Redis worker."""
        logger.info("[RedisWorker] Stopping...")
        self.running = False
        if self.pubsub:
            await self.pubsub.unsubscribe()
        if self.redis:
            await self.redis.close()

        # Cancel all running tasks
        for task in self._tasks:
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)

    async def _process_messages(self):
        """Main loop to process incoming Redis messages."""
        while self.running:
            try:
                message = await self.pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=1.0
                )
                if message:
                    await self._handle_message(message)
                else:
                    await asyncio.sleep(0.01)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[RedisWorker] Error in message loop: {e}")
                await asyncio.sleep(1)

    async def _handle_message(self, message: dict):
        """Handle a single message from Redis."""
        channel = message.get("channel", "")
        data = message.get("data")

        if not channel or not data:
            return

        # Case 1: Jules Monitoring Event
        if channel == "jules:monitor":
            try:
                payload = json.loads(data)
                task_id = payload.get("task_id")
                session_id = payload.get("session_id")
                if task_id and session_id:
                    logger.info(
                        f"[RedisWorker] Starting async monitoring for Task {task_id}, Session {session_id}"
                    )
                    task = asyncio.create_task(
                        self._poll_jules_status(task_id, session_id)
                    )
                    self._tasks.add(task)
                    task.add_done_callback(self._tasks.discard)
            except Exception as e:
                logger.error(f"[RedisWorker] Failed to handle jules:monitor: {e}")
            return

        # Case 2: Chat Request (pattern match)
        # channel: chat:request:<chat_id>
        parts = channel.split(":")
        if len(parts) >= 3 and parts[0] == "chat" and parts[1] == "request":
            chat_id = parts[2]
            logger.info(
                "[RedisWorker] RECEIVED chat:request:%s (len=%d)", chat_id, len(data)
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
                logger.info(f"[RedisWorker] Received STOP for chat {chat_id}")
                # Set cancellation flag in Redis (expires in 60s)
                await self.redis.set(f"chat:stop:{chat_id}", "true", ex=60)

                if chat_id in self.active_tasks:
                    self.active_tasks[chat_id].cancel()
                    # We don't remove it here immediately, let the task finish/cleanup
                return

            if frame.op != Op.MESSAGE:
                logger.warning(
                    f"[RedisWorker] Ignoring non-MESSAGE op: {frame.op} for chat {chat_id}"
                )
                return

            # For MESSAGE, we cancel previous task if any (debouncing/restart)
            if chat_id in self.active_tasks:
                logger.info(
                    f"[RedisWorker] Cancelling existing task for chat {chat_id}"
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
                        f"[RedisWorker] Task {chat_id} was cancelled correctly."
                    )
                    raise  # Re-raise to propagate cancellation up
                except Exception as e:
                    # Make sure we don't accidentally catch CancelledError here
                    if isinstance(e, asyncio.CancelledError):
                        logger.warning(
                            f"[RedisWorker] Task {chat_id} cancelled (caught as Exception)"
                        )
                        raise
                    logger.error(
                        f"[RedisWorker] Task error for chat {chat_id}: {e}",
                        exc_info=True,
                    )
                    # Try to send error frame to client
                    try:
                        from src.server.utils import make_error
                        trace_id = frame.trace_id if hasattr(frame, 'trace_id') else None
                        error_frame = make_error(
                            session.next_id,
                            "task_failed",
                            chat_id,
                            f"Task processing failed: {str(e)}",
                            http=500,
                            details={"error_type": type(e).__name__, "chat_id": chat_id, "trace_id": trace_id}
                        )
                        await session._send_frame(error_frame)
                    except Exception as send_err:
                        logger.error(
                            f"[RedisWorker] Failed to send error frame for chat {chat_id}: {send_err}",
                            exc_info=True,
                        )
                finally:
                    # Cleanup: Remove from active tasks registry
                    if self.active_tasks.get(chat_id) == current_task:
                        del self.active_tasks[chat_id]
                        logger.info(
                            f"[RedisWorker] Cleaned up task registry for chat {chat_id}"
                        )

            # We need reference to current_task inside, but we can't get it before creation.
            # So we create it first.
            t = asyncio.create_task(wrapped_task())
            current_task = t
            self.active_tasks[chat_id] = t

            await t

        except json.JSONDecodeError as e:
            logger.error(
                f"[RedisWorker] Failed to decode JSON for chat {chat_id}: {e}",
                exc_info=True,
            )
            # Try to send error frame if we have user_id
            try:
                # Extract user_id from raw_data if possible
                import json as json_lib
                try:
                    raw_payload = json_lib.loads(raw_data)
                    frame_payload = raw_payload.get("payload", {})
                    user_id = frame_payload.get("user_id") or frame_payload.get("sender")
                    if user_id:
                        from src.server.utils import make_error
                        from src.server.models import Frame, Op, Kind
                        from datetime import datetime, timezone
                        error_frame = Frame(
                            id=0,
                            ts=datetime.now(timezone.utc),
                            kind=Kind.ERROR,
                            op=Op.ERROR,
                            chat_id=chat_id,
                            error={
                                "code": "parse_failed",
                                "http": 400,
                                "message": f"Failed to parse request JSON: {str(e)}",
                                "details": {"error_type": "JSONDecodeError", "chat_id": chat_id}
                            }
                        )
                        # Publish directly to Redis
                        channel = f"chat:user:{user_id}"
                        await self.redis.publish(channel, json_lib.dumps(error_frame.marshal()))
                except Exception:
                    pass  # If we can't send error, at least we logged it
            except Exception:
                pass
        except asyncio.CancelledError:
            pass  # Expected
        except Exception as e:
            logger.error(
                f"[RedisWorker] Error processing request for {chat_id}: {e}",
                exc_info=True,
            )
            # Try to send error frame if possible
            try:
                import json as json_lib
                try:
                    raw_payload = json_lib.loads(raw_data)
                    frame_payload = raw_payload.get("payload", {})
                    user_id = frame_payload.get("user_id") or frame_payload.get("sender")
                    trace_id = raw_payload.get("trace_id")
                    if user_id:
                        from src.server.utils import make_error
                        from src.server.models import Frame, Op, Kind
                        from datetime import datetime, timezone
                        error_frame = Frame(
                            id=0,
                            ts=datetime.now(timezone.utc),
                            kind=Kind.ERROR,
                            op=Op.ERROR,
                            chat_id=chat_id,
                            trace_id=trace_id,
                            error={
                                "code": "worker_error",
                                "http": 500,
                                "message": f"Worker processing failed: {str(e)}",
                                "details": {
                                    "error_type": type(e).__name__,
                                    "chat_id": chat_id,
                                    "trace_id": trace_id
                                }
                            }
                        )
                        channel = f"chat:user:{user_id}"
                        await self.redis.publish(channel, json_lib.dumps(error_frame.marshal()))
                except Exception:
                    pass
            except Exception:
                pass

    async def _poll_jules_status(self, task_id: str, session_id: str):
        """
        Periodically polls Jules API for session completion.
        Updates task status to REVIEW upon success or FAILED on error.
        """
        if not self.jules_tool:
            logger.error(
                "[RedisWorker] Cannot poll Jules: Tool not initialized (Missing JULES_API_KEY)"
            )
            return

        timeout_minutes = 30
        poll_interval = 30
        end_time = asyncio.get_event_loop().time() + (timeout_minutes * 60)

        logger.info(
            f"[RedisWorker] Polling Jules session {session_id} for Task {task_id}"
        )

        while asyncio.get_event_loop().time() < end_time:
            try:
                # Use run_in_executor because JulesTools uses sync requests
                status_json = await asyncio.get_event_loop().run_in_executor(
                    None,
                    self.jules_tool.wait_for_completion,
                    session_id,
                    1,  # Check for 1 minute
                    15,  # Poll every 15 sec inside the blocking call
                )

                result = json.loads(status_json)
                status = result.get("status")

                if status == "completed":
                    pr_url = result.get("pr_url")
                    logger.info(
                        f"[RedisWorker] Session {session_id} COMPLETED. PR: {pr_url}"
                    )

                    artifacts = {"pr_url": pr_url} if pr_url else {}
                    await asyncio.get_event_loop().run_in_executor(
                        None,
                        self.task_tool.update_task_status,
                        task_id,
                        "REVIEW",
                        pr_url,
                        artifacts,
                    )
                    return

                elif status == "failed":
                    reason = result.get("reason", "Unknown")
                    logger.error(f"[RedisWorker] Session {session_id} FAILED: {reason}")
                    await asyncio.get_event_loop().run_in_executor(
                        None,
                        self.task_tool.update_task_status,
                        task_id,
                        "FAILED",
                        None,
                        {"error": reason},
                    )
                    return

                # If still running, continue polling
                await asyncio.sleep(poll_interval)

            except Exception as e:
                logger.error(
                    f"[RedisWorker] Error polling Jules session {session_id}: {e}"
                )
                await asyncio.sleep(poll_interval)

        # Timeout reached
        logger.warning(f"[RedisWorker] Timeout waiting for Jules session {session_id}")
