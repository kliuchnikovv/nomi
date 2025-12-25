import json
import pytest
from datetime import datetime, timezone
from typing import Optional, List, AsyncIterator
from fastapi import FastAPI
from starlette.testclient import TestClient
from src.server.models import Kind, Op
from src.server.ws import router as ws_router
from src.tools.models import ToolSpec

# Mock events that simulate what Agno might yield
class MockEvent:
    pass

class TextEvent(MockEvent):
    def __init__(self, content):
        self.content = content

class ToolCallEvent(MockEvent):
    def __init__(self, tool_name, args, result):
        # Determine strict structure based on Agno's real events
        # We simulate what ws.py expects: an object with 'tool' attribute or similar
        self.tool_name = tool_name
        self.tool_args = args
        self.result = result

    # To satisfy `if "ToolCallCompleted" in str(type(ev))`
    def __class__(self):
        pass

    # We will fake the class name check by making type(ev).__name__ return "ToolCallCompleted"
    # Or simpler: just use a class named ToolCallCompletedEvent

class ToolCallCompletedEvent:
    def __init__(self, name, args, result):
        self.tool = type('ToolExecution', (), {
            'tool_name': name,
            'tool_args': args,
            'result': result
        })

class ReasoningEvent:
    def __init__(self, content):
        self.reasoning_content = content
    # To satisfy logic in ws.py

class MockStreamAgent:
    def __init__(self):
        self.name = "stream_mock"
        self.last_tool_executions = []

    async def run(self, text: str, stream: bool = True, session_id: str = None, messages: list = None, stream_events: bool = False, images=None):
        # Yields a sequence of events: Text -> Tool -> Text -> Reasoning -> Text
        yield TextEvent("Hello, let me check. ")

        # Tool call
        yield ToolCallCompletedEvent("get_time", {"location": "London"}, "12:00")

        yield TextEvent("I checked the time. ")

        # Reasoning
        yield ReasoningEvent("Analyzing the time...")

        yield TextEvent("It is 12:00.")

class MockAgentFactory:
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
        web_search: bool = False,
        thinking: str = "off",
        user_id: str = None,
        chat_id: str = None,
    ) -> MockStreamAgent:
        return MockStreamAgent()

@pytest.fixture(scope="module")
def app_refactor() -> FastAPI:
    app = FastAPI()
    app.include_router(ws_router(MockAgentFactory()))
    return app

@pytest.fixture
def client(app_refactor: FastAPI):
    with TestClient(app_refactor) as c:
        yield c

def _frame(id, op, payload, chat_id=None):
    return {
        "v": "1", "id": id, "ts": datetime.now(timezone.utc).isoformat(),
        "kind": "meta" if op != Op.MESSAGE else "data", # simplified
        "op": op, "payload": payload or {}, "chat_id": chat_id
    }

def test_ordered_streaming(client: TestClient):
    """
    Verifies that tool calls and reasoning are streamed in order, interleaved with text.
    """
    with client.websocket_connect("/llm/ws?chat_id=chat-1", cookies={"session_id": "sess-1"}) as ws:
        # Handshake
        ws.send_text(json.dumps(_frame(1, Op.TOOLS.value, {"tools": []})))
        ws.send_text(json.dumps(_frame(2, Op.HISTORY.value, {"history": []})))

        # Send Message
        ws.send_text(json.dumps({
            "v": "1", "id": 3, "ts": "2024-01-01T00:00:00Z", "kind": "data",
            "op": Op.MESSAGE.value, "chat_id": "chat-1",
            "payload": {"message": "What time is it?"}
        }))

        # Consume frames and record order
        events = []

        while True:
            raw = ws.receive_text()
            data = json.loads(raw)
            op = data.get("op")

            if op == Op.DONE.value:
                break

            if op == Op.MESSAGE.value:
                payload = data.get("payload", {})

                # Check for Tool Call (Proposed new structure)
                if payload.get("type") == "tool_call":
                    events.append("TOOL: " + payload["tool"]["name"])

                # Check for Reasoning
                elif payload.get("type") == "metadata" and "reasoning_steps" in payload:
                    events.append("REASONING: " + payload["reasoning_steps"][0])

                # Check for Text
                elif "message" in payload and not payload.get("eof"):
                    msg = payload["message"]
                    if msg:
                        events.append("TEXT: " + msg)

        # Verify Order
        # Expected:
        # TEXT: Hello...
        # TOOL: get_time
        # TEXT: I checked...
        # REASONING: Analyzing...
        # TEXT: It is 12:00.

        print("Received events:", events)

        assert "TEXT: Hello, let me check. " in events
        assert "TOOL: get_time" in events
        assert "TEXT: I checked the time. " in events
        assert "REASONING: Analyzing the time..." in events
        assert "TEXT: It is 12:00." in events

        # Verify strict order
        idx_tool = events.index("TOOL: get_time")
        idx_reasoning = events.index("REASONING: Analyzing the time...")

        # Tool should be after first text
        assert idx_tool > events.index("TEXT: Hello, let me check. ")
        # Reasoning should be after "I checked..."
        assert idx_reasoning > events.index("TEXT: I checked the time. ")
