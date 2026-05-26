"""Judge worker for proactive event triage.

Subscribes to Redis channel pattern ``proactive:judge:*``.  For each event
message, runs the LLM judge and either:
  - "surface": publishes the event to ``chat:request:{updates_chat_id}`` so
    the main RedisWorker picks it up and runs the agent with source=proactive.
  - "skip": publishes the decision to ``proactive:decision:{event_id}`` for
    optional Go-side handling (PR2 or follow-up).

COORDINATION DEPENDENCY (PR2):
  The Go side must include ``updates_chat_id`` in the event JSON it publishes
  to ``proactive:judge:{user_id}``.  If missing, this worker logs a WARNING
  and skips surfacing (safe degradation).

Pattern mirrors back/src/server/redis_worker.py.
"""
import asyncio
import json
import logging
import os
from typing import Any

import redis.asyncio as redis

from src.proactive.judge import run_judge

logger = logging.getLogger(__name__)

CHANNEL_JUDGE_PATTERN = "proactive:judge:*"
CHANNEL_DECISION_FMT = "proactive:decision:{event_id}"
CHANNEL_CHAT_REQUEST_FMT = "chat:request:{chat_id}"


class JudgeWorker:
    def __init__(self):
        self.redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        self.redis: redis.Redis | None = None
        self.pubsub: Any | None = None
        self.running = False
        self._tasks: set[asyncio.Task] = set()

    async def start(self):
        """Connect to Redis and subscribe to proactive:judge:* channels."""
        safe_url = self.redis_url
        if "@" in safe_url:
            safe_url = safe_url.split("@")[-1]

        logger.warning("[JudgeWorker] Starting... URL: ...@%s", safe_url)
        self.running = True

        base_delay = 2.0
        max_delay = 60.0
        delay = base_delay

        while self.running:
            try:
                self.redis = redis.from_url(self.redis_url, decode_responses=True)
                self.pubsub = self.redis.pubsub()
                await self.pubsub.psubscribe(CHANNEL_JUDGE_PATTERN)

                # Wait for subscription confirmation
                confirmed = 0
                deadline = asyncio.get_event_loop().time() + 5.0
                while confirmed < 1 and asyncio.get_event_loop().time() < deadline:
                    message = await self.pubsub.get_message(
                        ignore_subscribe_messages=False, timeout=1.0
                    )
                    if message and message["type"] == "psubscribe":
                        confirmed += 1
                        logger.info(
                            "[JudgeWorker] Subscription confirmed: %s",
                            message.get("pattern"),
                        )

                logger.warning(
                    "[JudgeWorker] Successfully subscribed to %s", CHANNEL_JUDGE_PATTERN
                )
                asyncio.create_task(self._run_loop())
                return

            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(
                    "[JudgeWorker] Connection failed: %s, retrying in %.1fs...", e, delay
                )
                if not self.running:
                    return
                await asyncio.sleep(delay)
                delay = min(delay * 2, max_delay)

    async def _run_loop(self):
        """Background task: run message loop with reconnect on failure."""
        base_delay = 2.0
        max_delay = 60.0
        delay = base_delay

        while self.running:
            try:
                await self._process_messages()
                logger.error(
                    "[JudgeWorker] Message loop exited, reconnecting in %.1fs...", delay
                )
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(
                    "[JudgeWorker] Failed: %s, reconnecting in %.1fs...", e, delay, exc_info=True
                )

            if not self.running:
                break

            await asyncio.sleep(delay)
            delay = min(delay * 2, max_delay)

            try:
                self.redis = redis.from_url(self.redis_url, decode_responses=True)
                self.pubsub = self.redis.pubsub()
                await self.pubsub.psubscribe(CHANNEL_JUDGE_PATTERN)
                delay = base_delay
            except Exception as e:
                logger.error("[JudgeWorker] Reconnect failed: %s", e, exc_info=True)

    async def _process_messages(self):
        if not self.pubsub:
            logger.error("[JudgeWorker] PubSub not initialized")
            return

        try:
            async for message in self.pubsub.listen():
                if not self.running:
                    break
                if message:
                    await self._handle_message(message)
        except Exception as e:
            logger.error("[JudgeWorker] Message processing error: %s", e, exc_info=True)

    async def _handle_message(self, message: dict):
        channel = message.get("channel") or message.get("pattern") or ""
        if isinstance(channel, bytes):
            channel = channel.decode("utf-8", errors="replace")
        data = message.get("data")

        if not channel or not data:
            return
        if isinstance(data, bytes):
            data = data.decode("utf-8", errors="replace")
        elif isinstance(data, int):
            return  # subscriber count message

        # Only handle pattern matches for proactive:judge:*
        msg_type = message.get("type", "")
        if msg_type not in ("pmessage", "message"):
            return

        task = asyncio.create_task(self._process_event(data))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _process_event(self, raw_data: str):
        try:
            event = json.loads(raw_data)
        except json.JSONDecodeError as e:
            logger.error("[JudgeWorker] Failed to parse event JSON: %s", e)
            return

        event_id = event.get("event_id", "unknown")
        user_id = event.get("user_id", "unknown")
        updates_chat_id = event.get("updates_chat_id")

        logger.info(
            "[JudgeWorker] Processing event_id=%s user_id=%s type=%s",
            event_id,
            user_id,
            event.get("event_type", "unknown"),
        )

        try:
            result = await run_judge(event)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("[JudgeWorker] run_judge failed for event_id=%s: %s", event_id, e)
            return

        decision = result.get("decision", "skip")
        reason = result.get("reason", "")

        if decision == "surface":
            if not updates_chat_id:
                # COORDINATION DEPENDENCY: Go side (PR2) must include updates_chat_id
                # in the event JSON published to proactive:judge:{user_id}.
                logger.warning(
                    "[JudgeWorker] decision=surface but updates_chat_id missing for "
                    "event_id=%s — cannot surface without a target chat. "
                    "Go side (PR2) must include updates_chat_id in the event payload.",
                    event_id,
                )
                return

            # Publish to chat:request:{updates_chat_id} as a proactive frame
            # The main RedisWorker will pick this up and run the agent.
            from src.server.models import Frame, Kind, Op
            surface_payload = {
                "source": "proactive",
                "proactive_event": {
                    "event_id": event_id,
                    "event_type": event.get("event_type", "unknown"),
                    "payload": event.get("payload", {}),
                },
                "user_id": user_id,
                # Pass through agent_storage_mode if present
                **({
                    "agent_storage_mode": event["agent_storage_mode"]
                } if "agent_storage_mode" in event else {}),
            }
            frame = Frame(
                id=0,
                kind=Kind.SIGNAL,
                op=Op.MESSAGE,
                payload=surface_payload,
            )
            channel = CHANNEL_CHAT_REQUEST_FMT.format(chat_id=updates_chat_id)
            if self.redis:
                await self.redis.publish(channel, json.dumps(frame.marshal()))
                logger.info(
                    "[JudgeWorker] Surfaced event_id=%s to channel=%s", event_id, channel
                )
                # Also notify Go so it can mark event state=surfaced.
                decision_channel = CHANNEL_DECISION_FMT.format(event_id=event_id)
                await self.redis.publish(
                    decision_channel,
                    json.dumps({"decision": "surface", "reason": reason}),
                )

        else:
            # decision == "skip": publish to proactive:decision:{event_id} so
            # Go's decision_listener marks the event state=judge_rejected.
            decision_channel = CHANNEL_DECISION_FMT.format(event_id=event_id)
            decision_msg = json.dumps({"decision": "skip", "reason": reason})
            if self.redis:
                await self.redis.publish(decision_channel, decision_msg)
            logger.info(
                "[JudgeWorker] Skipped event_id=%s reason=%s", event_id, reason
            )

    async def stop(self):
        self.running = False
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
        logger.warning("[JudgeWorker] Stopped")
