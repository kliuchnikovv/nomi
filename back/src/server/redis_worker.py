import asyncio
import json
import logging
import os
import signal
import redis.asyncio as redis
from typing import Optional

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

    async def _process_request(self, chat_id: str, raw_data: str):
        """Process the request logic."""
        try:
            payload = json.loads(raw_data)
            frame = Frame(**payload)
            
            # Validate frame
            # We expect Op.MESSAGE mostly, but could differ
            if frame.op != Op.MESSAGE:
                logger.warning(f"[RedisWorker] Ignoring non-MESSAGE op: {frame.op} for chat {chat_id}")
                return

            # Extract user_id from payload if available, or rely on session logic
            # The Go API usually puts user_id in the frame payload or we might need it from the channel?
            # Go hub stores initiatorID. 
            # Ideally the frame payload should contain 'user_id' or similar metadata if needed for auth context.
            # However, looking at ws.py, user_id comes from token.
            # Refactor: Go should inject user_id into the frame payload or 'data' wrapper.
            
            # Let's assume the frame payload has a "user" object or similar, OR we use chat_id as session.
            # For now, we use chat_id as session_id.
            
            # We need to know the User ID to fetch tools and for RAG.
            # If the frame lacks it, we might be limited.
            # Go's HandleUserMessage:
            # msg := &chat.Message{ ... UserID: r.initiatorID ... }
            # Payload sent to LLM is `Frame`.
            # We should probably update Go to include `user_id` in the `Frame` or its payload.
            # But let's check Frame struct in `models.go` (Python) and `hub/models.go` (Go).
            # Frame has `Payload map[string]interface{}`.
            
            # ImplementationDetail: We will read `user_id` from payload if present.
            frame_payload = frame.payload or {}
            # Go sends "sender" (UUID), Python might look for "user_id". Handle both.
            user_id = frame_payload.get("user_id") or frame_payload.get("sender")
            
            session = RedisSession(
                agent_factory=self.agent_factory,
                session_id=chat_id,
                user_id=user_id,
                chat_id=chat_id
            )
            
            await session.handle_frame(frame)
            
        except json.JSONDecodeError:
            logger.error(f"[RedisWorker] Failed to decode JSON for chat {chat_id}")
        except Exception as e:
            logger.error(f"[RedisWorker] Error processing request for {chat_id}: {e}", exc_info=True)
