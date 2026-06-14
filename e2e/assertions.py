"""Small helpers for asserting on the frame contract.

These deliberately assert *structure* (ops, payload shape, ordering) rather than
exact LLM wording — except for the stub-brain's fixed strings, which are part of
the deterministic contract under test.
"""

from __future__ import annotations


def ops(frames: list[dict]) -> list[str]:
    return [f.get("op") for f in frames]


def payload(frame: dict) -> dict:
    return frame.get("payload") or {}


def text_frames(frames: list[dict]) -> list[dict]:
    """Streaming text deltas: op=message with a 'message' field, no special type."""
    out = []
    for f in frames:
        if f.get("op") != "message":
            continue
        p = payload(f)
        if "message" in p and p.get("type") not in ("tool_call", "reasoning", "actions"):
            out.append(f)
    return out


def tool_call_frames(frames: list[dict]) -> list[dict]:
    return [f for f in frames if payload(f).get("type") == "tool_call"]


def assembled_text(frames: list[dict]) -> str:
    return "".join(payload(f).get("message", "") for f in text_frames(frames))


def assert_terminal_done(frames: list[dict]) -> dict:
    """The last frame must be a clean DONE (not an error). Returns it."""
    assert frames, "no frames received"
    last = frames[-1]
    assert last.get("op") == "done", f"expected terminal 'done', got ops: {ops(frames)}"
    return last
