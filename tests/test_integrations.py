import asyncio
import json
import pytest
from unittest.mock import MagicMock, AsyncMock
from typing import Optional
from fastapi import FastAPI, WebSocketDisconnect
from starlette.testclient import TestClient

from src.server.ws import router as ws_router
from src.server.models import Op, Frame, Kind
from src.tools.models import ToolSpec
from agno.agent import Agent

# Mocks
class MockAgent:
    def __init__(self):
        self.name = "mock_agent"

    async def run(self, text: str, stream: bool = True, session_id: str = None, messages: list = None) -> str:
        if text == "fail":
            raise Exception("Intentional failure")
        return f"Response to: {text}"

    # Add dummy methods to satisfy Agent interface if needed
    async def arun(self, text: str, stream: bool = True, session_id: str = None, messages: list = None) -> str:
        if text == "fail":
            raise Exception("Intentional failure")
        return f"Response to: {text}"

class MockAgentFactory:
    _db = None
    _model = None
    _debug_mode = False

    def build_model(self, model_name: str):
        return None

    async def build(
        self,
        session_id: str,
        tools_specs: Optional[list] = None,
        model_name: Optional[str] = None,
        agent_type: Optional[str] = None,
        command_desc: Optional[dict] = None,
    ) -> Agent:
        return MockAgent()

@pytest.fixture
def app() -> FastAPI:
    app = FastAPI()
    app.include_router(ws_router(MockAgentFactory()))
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
    from datetime import datetime, timezone
    return {
        "v": "1",
        "id": id,
        "ts": datetime.now(timezone.utc).isoformat(),
        "kind": kind.value,
        "op": op.value,
        "payload": payload or {},
        "chat_id": chat_id,
    }

def test_integration_agent_websocket(client: TestClient):
    """Test full integration flow from WS -> Server -> Agent -> WS Response"""
    with client.websocket_connect(
        "/llm/ws?chat_id=chat-integration",
        cookies={"session_id": "sess-integration"},
    ) as ws:
        # 1. Skip Setup (Tools)
        ws.send_text(json.dumps(_frame(id=1, op=Op.TOOLS, payload={"tools": []})))
        # 2. Skip Setup (History)
        ws.send_text(json.dumps(_frame(id=2, op=Op.HISTORY, payload={"history": []})))

        # 3. Send Message
        ws.send_text(json.dumps(_frame(id=3, op=Op.MESSAGE, payload={"message": "hello world"}, chat_id="chat-integration")))

        # 4. Verify sequence of responses

        # Meta frame (Start)
        meta = ws.receive_json()
        assert meta["op"] == Op.MESSAGE.value
        assert meta["kind"] == Kind.META.value
        message_id = meta["payload"]["message_id"]

        # Data frames (Content)
        # MockAgent returns "Response to: hello world"
        # It might come in one or multiple chunks depending on implementation of _run_agent_stream fallback

        received_text = ""
        while True:
            msg = ws.receive_json()
            if msg["op"] == Op.MESSAGE.value and msg["kind"] == Kind.DATA.value:
                payload = msg["payload"]
                if payload.get("eof"):
                    break
                received_text += payload["message"]
                assert payload["message_id"] == message_id
            elif msg["op"] == Op.DONE.value:
                # Should not reach DONE before EOF frame
                pytest.fail("Received DONE before EOF")

        assert received_text == "Response to: hello world"

        # Meta frame (Usage)
        usage = ws.receive_json()
        assert usage["op"] == Op.MESSAGE.value
        assert usage["kind"] == Kind.META.value
        assert usage["payload"]["type"] == "usage"

        # Done frame
        done = ws.receive_json()
        assert done["op"] == Op.DONE.value
        assert done["payload"]["reason"] == "stop"


def test_integration_agent_error_handling(client: TestClient):
    """Test integration when agent raises exception"""
    with client.websocket_connect(
        "/llm/ws?chat_id=chat-error",
        cookies={"session_id": "sess-error"},
    ) as ws:
        # Setup
        ws.send_text(json.dumps(_frame(id=1, op=Op.TOOLS, payload={"tools": []})))
        ws.send_text(json.dumps(_frame(id=2, op=Op.HISTORY, payload={"history": []})))

        # Send "fail" which triggers exception in MockAgent
        ws.send_text(json.dumps(_frame(id=3, op=Op.MESSAGE, payload={"message": "fail"}, chat_id="chat-error")))

        # Meta frame (Start)
        ws.receive_json()

        # Expect Error frame
        error_frame = ws.receive_json()
        assert error_frame["kind"] == Kind.ERROR.value
        assert error_frame["op"] == Op.ERROR.value
        assert error_frame["error"]["code"] == "internal_error"
        assert "Intentional failure" in error_frame["error"]["message"]

        # Expect DONE frame with error reason
        done = ws.receive_json()
        assert done["op"] == Op.DONE.value
        assert done["payload"]["reason"] == "error"
