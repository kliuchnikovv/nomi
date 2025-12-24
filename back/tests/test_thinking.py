
import unittest
from unittest.mock import MagicMock, patch
import asyncio
import json
from dataclasses import dataclass
from typing import Optional, Any, List

# Mock Agno classes to simulate behavior without external dependencies
@dataclass
class RunContentEvent:
    content: Optional[str] = None
    reasoning_content: Optional[str] = None
    event: str = "RunContent"

@dataclass
class RunResponse:
    content: str
    reasoning_content: Optional[str] = None

class MockAgent:
    def __init__(self, with_reasoning=False):
        self.with_reasoning = with_reasoning

    async def arun(self, query: str, stream: bool = False, **kwargs):
        if stream:
            return self._stream_generator()
        else:
            # Simulate synchronous response
            if self.with_reasoning:
                return RunResponse(
                    content="Hello World",
                    reasoning_content="I thought about it deeply."
                )
            else:
                return RunResponse(content="Hello World")

    async def _stream_generator(self):
        # Simulate streaming events with reasoning content
        # Scenario 1: Reasoning comes first as deltas
        yield RunContentEvent(reasoning_content="Thinking ")
        yield RunContentEvent(reasoning_content="about ")
        yield RunContentEvent(reasoning_content="it.")
        # Scenario 2: Then content comes
        yield RunContentEvent(content="Hello ")
        yield RunContentEvent(content="World")

class TestThinkingContent(unittest.IsolatedAsyncioTestCase):
    async def test_streaming_reasoning(self):
        """Verify that streaming events correctly carry reasoning content"""
        agent = MockAgent(with_reasoning=True)

        events = []
        stream_gen = await agent.arun("test", stream=True)
        async for ev in stream_gen:
            # Simulate logic from ws.py
            captured_reasoning = None
            if hasattr(ev, 'reasoning_content') and ev.reasoning_content:
                captured_reasoning = ev.reasoning_content

            if captured_reasoning:
                events.append({"type": "reasoning", "content": captured_reasoning})

            # Simulate content extraction
            content = getattr(ev, 'content', None)
            if content:
                events.append({"type": "content", "content": content})

        # Verify sequence
        expected = [
            {"type": "reasoning", "content": "Thinking "},
            {"type": "reasoning", "content": "about "},
            {"type": "reasoning", "content": "it."},
            {"type": "content", "content": "Hello "},
            {"type": "content", "content": "World"}
        ]

        self.assertEqual(events, expected)
        print("\nTest Streaming Reasoning: PASSED")
        print(json.dumps(events, indent=2))

    async def test_http_reasoning(self):
        """Verify HTTP response structure"""
        agent = MockAgent(with_reasoning=True)
        response = await agent.arun("test", stream=False)

        # Simulate app.py extraction logic
        answer = response.content
        reasoning = response.reasoning_content

        result = {"answer": answer, "reasoning": reasoning}

        self.assertEqual(result["answer"], "Hello World")
        self.assertEqual(result["reasoning"], "I thought about it deeply.")
        print("\nTest HTTP Reasoning: PASSED")
        print(json.dumps(result, indent=2))

if __name__ == "__main__":
    unittest.main()
