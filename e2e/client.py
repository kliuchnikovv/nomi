"""WebSocket chat client for driving the Go API end to end.

Mirrors what the mobile app sends: a ``message`` frame over ``/api/chat/ws``,
shaped per ``api/internal/hub`` (Frame + UserMessagePayload). The Go room
broadcasts responses as newline-delimited JSON frames; ``collect_until_done``
parses them in order until a terminal ``done`` / ``error`` op.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone

import websockets


def _ws_url(base_url: str, chat_id: str, mode: str, tz: str) -> str:
    ws = base_url.replace("https://", "wss://").replace("http://", "ws://").rstrip("/")
    return f"{ws}/api/chat/ws?chat_id={chat_id}&mode={mode}&timezone={tz}"


class ChatClient:
    """Async context manager around one authenticated chat WebSocket."""

    def __init__(self, base_url: str, token: str, chat_id: str, *, mode: str = "agent", tz: str = "UTC"):
        self._url = _ws_url(base_url, chat_id, mode, tz)
        self._token = token
        self.chat_id = chat_id
        self._ws = None

    async def __aenter__(self) -> "ChatClient":
        # Auth is via the Authorization header (the Go auth middleware has no
        # query-param token fallback). websockets>=12 uses additional_headers.
        self._ws = await websockets.connect(
            self._url, additional_headers={"Authorization": f"Bearer {self._token}"}
        )
        return self

    async def __aexit__(self, *exc) -> None:
        if self._ws is not None:
            await self._ws.close()

    async def send_message(self, text: str, message_id: str | None = None) -> str:
        message_id = message_id or str(uuid.uuid4())
        frame = {
            "v": "1",
            "id": 0,
            "ts": datetime.now(timezone.utc).isoformat(),
            "kind": "data",
            "op": "message",
            "chat_id": self.chat_id,
            "payload": {
                "message": text,
                "message_id": message_id,
                "model": "gemini-2.5-pro",
            },
        }
        await self._ws.send(json.dumps(frame))
        return message_id

    async def collect_until_done(self, timeout: float = 20.0) -> list[dict]:
        """Collect frames in order until a terminal op, or raise on timeout."""
        frames: list[dict] = []

        async def _loop() -> None:
            while True:
                raw = await self._ws.recv()
                # Go may batch multiple NDJSON frames into one WS message.
                for line in str(raw).splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    frame = json.loads(line)
                    frames.append(frame)
                    if frame.get("op") in ("done", "error"):
                        return

        await asyncio.wait_for(_loop(), timeout=timeout)
        return frames
