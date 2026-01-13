import asyncio
import json
import logging
import os
import signal
import redis.asyncio as redis
from typing import Optional, Dict, Set

from agno.agent import Agent
from agno.models.base import Model

from src.server.models import Frame, Op
from src.server.utils import make_error
from src.server.redis_session import RedisSession
from src.agents.factory import AgentFactory
from src.tools.config import ToolConfigClient

logger = logging.getLogger(__name__)

class RedisWorker:
    def __init__(self, agent_factory: AgentFactory):
        self.agent_factory = agent_factory
        self.redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        self.redis = None
        self.pubsub = None
        self.running = False
        self._tasks = set()

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
            
            # Subscribe to chat requests: chat:request:*
            # Pattern: chat:request:<chat_id>
            await self.pubsub.psubscribe("chat:request:*")
            
            logger.warning("[RedisWorker] Successfully subscribed to chat:request:*")
            
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
                message = await self.pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
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
        # message format: {'type': 'pmessage', 'pattern': 'chat:request:*', 'channel': 'chat:request:<id>', 'data': '...'}
        channel = message.get("channel")
        data = message.get("data")
        
        if not channel or not data:
            return

        # Extract chat_id from channel
        # channel: chat:request:<chat_id>
        parts = channel.split(":")
        if len(parts) < 3:
            logger.warning(f"[RedisWorker] Invalid channel format: {channel}")
            return
            
        chat_id = parts[2]
        
        # Fire and forget task to handle the request
        logger.info("[RedisWorker] RECEIVED chat:request:%s (len=%d)", chat_id, len(data))
        task = asyncio.create_task(self._process_request(chat_id, data))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    
    # Global task registry
    ACTIVE_TASKS: Dict[str, asyncio.Task] = {}

    async def _process_request(self, chat_id: str, raw_data: str):
        """Process the request logic."""
        task_id = chat_id # Use chat_id as task key. 
        # If we need per-message cancellation, we'd need message_id, but usually we cancel the whole generation for the chat.

        try:
            payload = json.loads(raw_data)
            frame = Frame(**payload)
            
            # Validate frame
            if frame.op == Op.PING:
                return

            if frame.op == Op.STOP:
                logger.info(f"[RedisWorker] Received STOP for chat {chat_id}")
                if chat_id in self.ACTIVE_TASKS:
                    self.ACTIVE_TASKS[chat_id].cancel()
                    # We don't remove it here immediately, let the task finish/cleanup
                return

            if frame.op != Op.MESSAGE:
                logger.warning(f"[RedisWorker] Ignoring non-MESSAGE op: {frame.op} for chat {chat_id}")
                return

            # For MESSAGE, we cancel previous task if any (debouncing/restart)
            if chat_id in self.ACTIVE_TASKS:
                logger.info(f"[RedisWorker] Cancelling existing task for chat {chat_id}")
                self.ACTIVE_TASKS[chat_id].cancel()
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
                chat_id=chat_id
            )
            
            # Create new task
            # We wrap it to ensure cleanup from registry
            async def wrapped_task():
                try:
                    await session.handle_frame(frame)
                except asyncio.CancelledError:
                    logger.info(f"[RedisWorker] Task cancelled for chat {chat_id}")
                    raise
                except Exception as e:
                    logger.error(f"[RedisWorker] Task error for chat {chat_id}: {e}")
                finally:
                    if self.ACTIVE_TASKS.get(chat_id) == current_task:
                        del self.ACTIVE_TASKS[chat_id]

            # We need reference to current_task inside, but we can't get it before creation.
            # So we create it first.
            t = asyncio.create_task(wrapped_task())
            current_task = t
            self.ACTIVE_TASKS[chat_id] = t
            
            await t
            
        except json.JSONDecodeError:
            logger.error(f"[RedisWorker] Failed to decode JSON for chat {chat_id}")
        except asyncio.CancelledError:
            pass # Expected
        except Exception as e:
            logger.error(f"[RedisWorker] Error processing request for {chat_id}: {e}", exc_info=True)
