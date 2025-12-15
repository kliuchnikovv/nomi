import logging
import json
from datetime import datetime, timezone
import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient
from src.server.models import Kind, Op
from src.server.ws import router as ws_router

class DummyAgent:
    async def run(self, text: str) -> str:
        return f"echo:{text}"

class DummyAgentFactory:
    async def build(self, session_id: str, tools_specs=None) -> DummyAgent:
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

def test_tools_logging(client: TestClient, caplog):
    caplog.set_level(logging.INFO)
    
    with client.websocket_connect(
        "/llm/ws?chat_id=chat-1",
        cookies={"session_id": "sess-1"},
    ) as ws:
        # Send TOOLS frame
        tools_payload = {
            "tools": [
                {"name": "tool1", "enabled": True},
                {"name": "tool2", "enabled": False}
            ]
        }
        ws.send_text(json.dumps(_frame(id=1, op=Op.TOOLS, payload=tools_payload)))
        
        # Wait a bit for processing (though receive_text below might be enough if server sends something back, 
        # but here we just want to check logs after connection setup)
        # The server logic waits for tools, then logs, then builds agent.
        # We can try to send a message to ensure the loop has progressed past tool reception.
        ws.send_text(json.dumps(_frame(id=2, op=Op.MESSAGE, payload={"message": "hi"})))
        
        # Consume response to ensure processing happened
        try:
            ws.receive_json() 
        except:
            pass

    # Check logs
    assert "[WS] Received tools: session_id=sess-1 count=2 names=['tool1', 'tool2']" in caplog.text
