import asyncio
import json
from datetime import datetime, timezone
from typing import Optional, List

import pytest
from fastapi import FastAPI, WebSocketDisconnect
from starlette.testclient import TestClient

from src.server.models import Kind, Op, Frame
from src.server.ws import router as ws_router
from src.tools.models import ToolSpec


class DummyAgent:
    def __init__(self):
        self.name = "dummy"

    async def run(self, text: str, stream: bool = True, session_id: str = None, messages: list = None) -> str:
        # Echo-like behavior for predictable tests
        return f"echo:{text}"

    # Add dummy methods to satisfy Agent interface if needed
    async def arun(self, text: str, stream: bool = True, session_id: str = None, messages: list = None) -> str:
        return f"echo:{text}"

class DummyAgentFactory:
    _db = None
    _model = None
    _debug_mode = False

    def build_model(self, model_name: str):
        return None

    async def build(
        self,
        session_id: str,
        tools_specs: Optional[List[ToolSpec]] = None,
        model_name: Optional[str] = None,
        agent_type: Optional[str] = None,
        command_desc: Optional[dict] = None,
    ) -> DummyAgent:
        return DummyAgent()


@pytest.fixture(scope="module")
def app() -> FastAPI:
    app = FastAPI()
    app.include_router(ws_router(DummyAgentFactory()))
    return app


@pytest.fixture
def client(app: FastAPI):
    with TestClient(app) as c:
        yield c


def _frame(
    *,
    id: int,
    kind: Kind = Kind.META,
    op: Op = Op.MESSAGE,
    payload: dict | None = None,
    chat_id: str | None = None,
):
    return {
        "v": "1",
        "id": id,
        "ts": datetime.now(timezone.utc).isoformat(),
        "kind": kind.value,
        "op": op.value,
        "payload": payload or {},
        "chat_id": chat_id,
    }


def test_handshake_and_auth_success(client: TestClient):
    with client.websocket_connect(
        "/llm/ws?chat_id=chat-1",
        cookies={"session_id": "sess-1"},
    ) as ws:
        # The server waits for TOOLS, but we can close immediately
        ws.close()


def test_auth_missing_cookie_rejected(client: TestClient):
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect("/llm/ws?chat_id=chat-1") as ws:
            # We need to try to receive to get the close message?
            ws.receive_text()
    assert excinfo.value.code == 1008


def test_auth_missing_chat_id_rejected(client: TestClient):
    with client.websocket_connect(
        "/llm/ws",
        cookies={"session_id": "sess-1"},
    ) as ws:
        pass


def test_ping_pong(client: TestClient):
    with client.websocket_connect(
        "/llm/ws?chat_id=chat-1",
        cookies={"session_id": "sess-1"},
    ) as ws:
        # Server might wait for TOOLS.
        # But we can send PING immediately.
        ws.send_text(json.dumps(_frame(id=1, op=Op.PING, payload={})))

        # We should send dummy TOOLS or just skip setup frames.

        # Sending dummy TOOLS
        ws.send_text(json.dumps(_frame(id=1, op=Op.TOOLS, payload={"tools": []})))

        # Sending dummy HISTORY (optional) or let it timeout?
        # Timeout is 2s, slow for tests.
        # Send empty HISTORY or just something else (which will be ignored as non-history).
        ws.send_text(json.dumps(_frame(id=2, op=Op.HISTORY, payload={"history": []})))

        # Now main loop.
        ws.send_text(json.dumps(_frame(id=3, op=Op.PING, payload={})))

        # Expect PONG.
        # We might receive some logs or errors if we are not careful?
        # The server doesn't send anything back during setup unless error.

        # Read PONG
        response = ws.receive_json()
        assert response["op"] == Op.PONG.value


def test_bad_frame_invalid_json(client: TestClient):
    with client.websocket_connect(
        "/llm/ws?chat_id=chat-1",
        cookies={"session_id": "sess-1"},
    ) as ws:
        # Skip setup
        ws.send_text(json.dumps(_frame(id=1, op=Op.TOOLS, payload={"tools": []})))
        ws.send_text(json.dumps(_frame(id=2, op=Op.HISTORY, payload={"history": []})))

        # send malformed JSON
        ws.send_text("{not-json}")
        err = ws.receive_json()
        assert err["kind"] == Kind.ERROR.value
        assert err["op"] == Op.ERROR.value
        assert err["error"]["code"] == "bad_request"
        assert err["error"]["http"] == 400


def test_message_flow_basic(client: TestClient):
    with client.websocket_connect(
        "/llm/ws?chat_id=chat-1",
        cookies={"session_id": "sess-1"},
    ) as ws:
        # Skip setup
        ws.send_text(json.dumps(_frame(id=1, op=Op.TOOLS, payload={"tools": []})))
        ws.send_text(json.dumps(_frame(id=2, op=Op.HISTORY, payload={"history": []})))

        ws.send_text(json.dumps(_frame(id=3, op=Op.MESSAGE, payload={"message": "hi"}, chat_id="chat-1")))

        # Expect a META start frame
        meta = ws.receive_json()
        assert meta["kind"] == Kind.META.value
        assert meta["op"] == Op.MESSAGE.value
        assert meta["payload"]["message_id"]

        # Expect some DATA frames (streamed chunks)
        # DummyAgent returns "echo:hi"
        # It might be split or sent as one chunk.

        data = ws.receive_json()
        assert data["kind"] == Kind.DATA.value
        assert data["op"] == Op.MESSAGE.value
        assert data["payload"]["message"] == "echo:hi"

        # Consume until we get DONE
        # There may be a META usage frame before DONE
        seen_done = False
        # We might receive EOF frame too.

        while True:
            msg = ws.receive_json()
            if msg["op"] == Op.DONE.value:
                seen_done = True
                break
            if msg["op"] == Op.MESSAGE.value and msg["kind"] == Kind.DATA.value:
                if msg["payload"].get("eof"):
                    continue

        assert seen_done, "did not receive DONE frame"


def test_keepalive_ping_on_timeout(monkeypatch, client: TestClient):
    # Patch asyncio.wait_for used inside the ws module to trigger TimeoutError once
    import src.server.ws as ws_mod

    called = {"n": 0}
    original = ws_mod.asyncio.wait_for

    async def fake_wait_for(awaitable, timeout=None):
        # Allow the setup calls to pass through (timeout is small there 5.0, 2.0)
        # But we want to fail the main loop wait_for (timeout=30)
        if timeout == 30:
             if called["n"] == 0:
                called["n"] += 1
                raise asyncio.TimeoutError()
        return await original(awaitable, timeout)

    monkeypatch.setattr(ws_mod.asyncio, "wait_for", fake_wait_for)

    with client.websocket_connect(
        "/llm/ws?chat_id=chat-1",
        cookies={"session_id": "sess-1"},
    ) as ws:
        # Skip setup
        ws.send_text(json.dumps(_frame(id=1, op=Op.TOOLS, payload={"tools": []})))
        ws.send_text(json.dumps(_frame(id=2, op=Op.HISTORY, payload={"history": []})))

        # After a forced timeout, server should send a keepalive ping
        # The setup frames are consumed by server.
        # Then it enters main loop.
        # wait_for(..., 30) raises TimeoutError
        # Server sends PING.

        ping = ws.receive_json()
        assert ping["op"] == Op.PING.value
