import asyncio
import json
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from src.server.models import Kind, Op
from src.server.ws import router as ws_router


class DummyAgent:
    async def run(self, text: str) -> str:
        # Echo-like behavior for predictable tests
        return f"echo:{text}"


class DummyAgentFactory:
    async def build(self, session_id: str) -> DummyAgent:
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
):
    return {
        "v": "1",
        "id": id,
        "ts": datetime.now(timezone.utc).isoformat(),
        "kind": kind.value,
        "op": op.value,
        "payload": payload or {},
    }


def test_handshake_and_auth_success(client: TestClient):
    with client.websocket_connect(
        "/llm/ws?chat_id=chat-1",
        cookies={"session_id": "sess-1"},
    ) as ws:
        # Immediately close; if handshake failed, this would raise earlier
        ws.close()


def test_auth_missing_cookie_rejected(client: TestClient):
    with pytest.raises(Exception):
        # Server should close with 1008 during accept if no session cookie
        client.websocket_connect("/llm/ws?chat_id=chat-1")


def test_auth_missing_chat_id_rejected(client: TestClient):
    with pytest.raises(Exception):
        client.websocket_connect("/llm/ws", cookies={"session_id": "sess-1"})


def test_ping_pong(client: TestClient):
    with client.websocket_connect(
        "/llm/ws?chat_id=chat-1",
        cookies={"session_id": "sess-1"},
    ) as ws:
        ws.send_text(json.dumps(_frame(id=1, op=Op.PING, payload={})))
        assert ws.receive_text() == "pong"


def test_bad_frame_invalid_json(client: TestClient):
    with client.websocket_connect(
        "/llm/ws?chat_id=chat-1",
        cookies={"session_id": "sess-1"},
    ) as ws:
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
        ws.send_text(json.dumps(_frame(id=1, op=Op.MESSAGE, payload={"message": "hi"})))

        # Expect a META start frame
        meta = ws.receive_json()
        assert meta["kind"] == Kind.META.value
        assert meta["op"] == Op.MESSAGE.value

        # Expect some DATA frames (streamed chunks)
        data = ws.receive_json()
        assert data["kind"] == Kind.DATA.value
        assert data["op"] == Op.MESSAGE.value

        # Consume until we get DONE
        # There may be multiple DATA and a META usage frame
        seen_done = False
        for _ in range(10):
            msg = ws.receive_json()
            if msg["op"] == Op.DONE.value:
                seen_done = True
                break
        assert seen_done, "did not receive DONE frame"


def test_keepalive_ping_on_timeout(monkeypatch, client: TestClient):
    # Patch asyncio.wait_for used inside the ws module to trigger TimeoutError once
    import src.server.ws as ws_mod

    called = {"n": 0}
    original = ws_mod.asyncio.wait_for

    async def fake_wait_for(awaitable, timeout=None):
        if called["n"] == 0:
            called["n"] += 1
            raise asyncio.TimeoutError()
        return await original(awaitable, timeout)

    monkeypatch.setattr(ws_mod.asyncio, "wait_for", fake_wait_for)

    with client.websocket_connect(
        "/llm/ws?chat_id=chat-1",
        cookies={"session_id": "sess-1"},
    ) as ws:
        # After a forced timeout, server should send a keepalive ping
        assert ws.receive_text() == "ping"
        # Close to avoid waiting for further reads
        ws.close()


# The following areas are out of scope for unit tests or not implemented:
# - Binary messages, CORS/SSL/TLS specifics, subprotocol auth
# - Replay/idempotency, broadcast/rooms, reconnect logic
# - Resource leak detection, load/perf
# Marked as skipped to document intent.

@pytest.mark.skip(reason="Binary messaging not implemented/tested in server")
def test_binary_messages_placeholder():
    pass


@pytest.mark.skip(reason="Broadcast/rooms are not implemented in this server")
def test_multi_clients_broadcast_placeholder():
    pass


@pytest.mark.skip(reason="Reconnect logic belongs to client implementation")
def test_client_reconnect_placeholder():
    pass


@pytest.mark.skip(reason="Perf/resource tests are not suitable for unit test suite")
def test_perf_and_resources_placeholder():
    pass
