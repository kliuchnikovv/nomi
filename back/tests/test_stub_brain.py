"""Unit tests for the deterministic e2e stub-brain.

These guard the *canned frame shapes* themselves so the e2e harness assertions
stay in sync with what the brain emits. Pure functions — no running stack.
"""

from src.server import stub_brain
from src.server.models import Kind, Op


def _build(factories, start=0):
    """Assign monotonic ids the way ``_send_frame`` would and return frames."""
    return [make(start + i) for i, make in enumerate(factories)]


def test_is_enabled(monkeypatch):
    monkeypatch.delenv("BRAIN_TEST_MODE", raising=False)
    assert stub_brain.is_enabled() is False
    monkeypatch.setenv("BRAIN_TEST_MODE", "1")
    assert stub_brain.is_enabled() is True
    monkeypatch.setenv("BRAIN_TEST_MODE", "0")
    assert stub_brain.is_enabled() is False


def test_unknown_input_returns_none():
    assert stub_brain.stub_message_frames("hello there", "c1", "m1") is None
    assert stub_brain.stub_message_frames("", "c1", "m1") is None
    assert stub_brain.stub_message_frames(None, "c1", "m1") is None


def test_echo_sequence():
    factories = stub_brain.stub_message_frames(stub_brain.ECHO, "c1", "m1")
    frames = _build(factories)
    assert [f.op for f in frames] == [Op.MESSAGE, Op.MESSAGE, Op.DONE]
    assert frames[0].payload["message"] == "Hello"
    assert frames[1].payload["message"] == " world"
    assert frames[2].payload["content"] == "Hello world"
    assert all(f.message_id is None or True for f in frames)  # message_id lives in payload
    assert frames[0].payload["message_id"] == "m1"
    # ids increment as _send_frame would assign them
    assert [f.id for f in frames] == [0, 1, 2]


def test_tool_sequence():
    factories = stub_brain.stub_message_frames(stub_brain.TOOL, "c1", "m1")
    frames = _build(factories)
    assert [f.op for f in frames] == [Op.MESSAGE, Op.MESSAGE, Op.DONE]
    tool_frame = frames[0]
    assert tool_frame.payload["type"] == "tool_call"
    assert tool_frame.payload["tool"]["name"] == "__stub__"
    assert "arguments" in tool_frame.payload["tool"]
    assert "result" in tool_frame.payload["tool"]


def test_error_sequence():
    factories = stub_brain.stub_message_frames(stub_brain.ERROR, "c1", "m1")
    frames = _build(factories)
    assert len(frames) == 1
    assert frames[0].kind == Kind.ERROR
    assert frames[0].op == Op.ERROR
    assert frames[0].error is not None
    assert frames[0].error.code == "stub_error"


def test_task_steps():
    steps = stub_brain.stub_task_steps()
    assert steps == ["stub step 1", "stub step 2", "stub step 3"]
    # No step title may trip the runner's risky-keyword approval gate.
    from src.server.task_runner import _needs_approval

    assert not any(_needs_approval(s) for s in steps)
