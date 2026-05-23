"""
GoWSClient — persistent WebSocket connection from Python worker to Go API.

Response frames are sent directly over this connection instead of going through
Redis pub/sub, eliminating 2–5ms RTT per token.

Redis is still used for requests (Go → Python) and out-of-band signals.
"""
import asyncio
import json
import logging
import os
from typing import Optional

import websockets
from websockets.exceptions import ConnectionClosed, WebSocketException

from src.server.models import Frame

logger = logging.getLogger(__name__)

_INITIAL_BACKOFF = 1.0
_MAX_BACKOFF = 30.0


class GoWSClient:
    """Maintains a persistent WebSocket connection to the Go API worker endpoint."""

    def __init__(self) -> None:
        url = os.getenv("GO_API_URL", "http://localhost:8080")
        # Convert http(s):// → ws(s)://
        url = url.replace("https://", "wss://").replace("http://", "ws://")
        self._url = url.rstrip("/") + "/internal/worker"
        self._token = os.getenv("WORKER_TOKEN", "")
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._send_queue: asyncio.Queue[str] = asyncio.Queue()
        self._connected = asyncio.Event()
        self._shutdown = False
        self._tasks: list[asyncio.Task] = []
        # Per-chatID tracking for reconnect de-dup.
        # last_sent: last frame.id successfully written to the socket per chat_id.
        # last_acked: Go's confirmed last_received per chat_id (from resume_ack).
        self._last_sent: dict[str, int] = {}
        self._last_acked: dict[str, int] = {}
        self._last_sent_lock = asyncio.Lock()

    async def connect(self) -> None:
        """Start the background connection loop. Returns immediately."""
        task = asyncio.create_task(self._connection_loop(), name="go_ws_client_loop")
        self._tasks.append(task)
        # Wait briefly so the first connection attempt completes before we send frames.
        try:
            await asyncio.wait_for(self._connected.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning("[GoWSClient] Could not connect within 5s — will retry in background")

    async def close(self) -> None:
        self._shutdown = True
        for t in self._tasks:
            t.cancel()
        if self._ws:
            await self._ws.close()

    @property
    def is_connected(self) -> bool:
        return self._ws is not None and not self._ws.closed

    async def send_frame(self, frame: Frame) -> None:
        """Queue a frame for delivery to Go. Non-blocking."""
        payload = json.dumps(frame.marshal())
        await self._send_queue.put(payload)
        # Track last queued frame per chatID so we can build RESUME on reconnect.
        if frame.chat_id:
            async with self._last_sent_lock:
                prev = self._last_sent.get(frame.chat_id, 0)
                if frame.id > prev:
                    self._last_sent[frame.chat_id] = frame.id

    # ------------------------------------------------------------------ #
    # Internal                                                              #
    # ------------------------------------------------------------------ #

    async def _send_resume(self, ws: websockets.WebSocketClientProtocol) -> None:
        """Send a RESUME frame to Go so it can confirm what it already received."""
        async with self._last_sent_lock:
            sessions = [
                {"chat_id": chat_id, "last_sent": last_id}
                for chat_id, last_id in self._last_sent.items()
            ]
        if not sessions:
            return
        frame = json.dumps({"op": "worker_resume", "sessions": sessions})
        try:
            await ws.send(frame)
            logger.info("[GoWSClient] RESUME sent for %d chats", len(sessions))
        except Exception as e:
            logger.warning("[GoWSClient] Failed to send RESUME: %s", e)

    async def _connection_loop(self) -> None:
        backoff = _INITIAL_BACKOFF
        is_reconnect = False
        while not self._shutdown:
            try:
                headers = {}
                if self._token:
                    headers["X-Worker-Token"] = self._token
                logger.info("[GoWSClient] Connecting to %s", self._url)
                async with websockets.connect(
                    self._url,
                    additional_headers=headers,
                    ping_interval=30,
                    ping_timeout=10,
                ) as ws:
                    self._ws = ws
                    self._connected.set()
                    backoff = _INITIAL_BACKOFF
                    logger.info("[GoWSClient] Connected (reconnect=%s)", is_reconnect)
                    # On reconnect, tell Go what we last sent so it can ACK back
                    # and we can skip re-queued frames that Go already received.
                    if is_reconnect:
                        await self._send_resume(ws)
                    await asyncio.gather(
                        self._send_loop(ws),
                        self._recv_loop(ws),
                        return_exceptions=True,
                    )
            except (ConnectionClosed, WebSocketException, OSError) as e:
                logger.warning("[GoWSClient] Connection lost: %s", e)
            except asyncio.CancelledError:
                return
            except Exception as e:
                logger.error("[GoWSClient] Unexpected error: %s", e, exc_info=True)
            finally:
                self._ws = None
                self._connected.clear()
                is_reconnect = True

            if self._shutdown:
                return
            logger.info("[GoWSClient] Reconnecting in %.1fs", backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, _MAX_BACKOFF)

    async def _send_loop(self, ws: websockets.WebSocketClientProtocol) -> None:
        while True:
            payload = await self._send_queue.get()
            # Skip frames that Go already confirmed receiving (de-dup on reconnect).
            try:
                parsed = json.loads(payload)
                chat_id = parsed.get("chat_id")
                frame_id = parsed.get("id", 0)
                if chat_id and frame_id:
                    last_acked = self._last_acked.get(chat_id, 0)
                    if frame_id <= last_acked:
                        logger.debug("[GoWSClient] Skipping duplicate frame id=%d chat=%s", frame_id, chat_id)
                        continue
            except Exception:
                pass
            try:
                await ws.send(payload)
            except Exception:
                # Re-queue so it can be retried after reconnect.
                await self._send_queue.put(payload)
                raise

    async def _recv_loop(self, ws: websockets.WebSocketClientProtocol) -> None:
        """Receive control messages from Go (resume_ack, future request frames)."""
        async for msg in ws:
            try:
                data = json.loads(msg)
            except Exception:
                continue
            if data.get("op") == "worker_resume_ack":
                for session in data.get("sessions", []):
                    chat_id = session.get("chat_id")
                    last_received = session.get("last_received", 0)
                    if chat_id:
                        self._last_acked[chat_id] = last_received
                logger.info("[GoWSClient] resume_ack: %d chats confirmed", len(data.get("sessions", [])))
