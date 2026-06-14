"""Deterministic stub-brain for end-to-end regression tests.

When ``BRAIN_TEST_MODE=1`` is set, recognized magic inputs short-circuit real
agent / LLM execution and emit a *fixed* sequence of frames instead. This lets
the e2e harness assert the exact protocol contract (frame ordering, payload
shapes, persistence, task lifecycle) deterministically, with no LLM keys and no
network flakiness.

Every canned frame mirrors the real production payload shapes built in
``redis_session.py`` so the harness exercises the true contract:

- text delta   -> ``make_data(id, Op.MESSAGE, chat_id, {"ix", "eof", "message", "message_id"})``
- tool call    -> ``make_data(id, Op.MESSAGE, chat_id, {"type": "tool_call", "tool": {...}, "message_id"})``
- error        -> ``make_error(id, code, chat_id, message)``
- done         -> ``make_done(id, chat_id, {"message_id", "content"})``

This module is pure (no I/O beyond reading the env flag): it returns *frame
factories* — ``Callable[[int], Frame]`` — so the caller assigns the monotonic
frame id at send time (``_send_frame`` increments ``next_id`` per send).
"""

from __future__ import annotations

import os
from collections.abc import Callable

from src.server.models import Frame, Op
from src.server.utils import make_data, make_done, make_error

# Magic inputs recognized in stub mode. Chosen to be unmistakable so they can
# never collide with a real user message.
ECHO = "__e2e_echo__"
TOOL = "__e2e_tool__"
ERROR = "__e2e_error__"
TASK = "__e2e_task__"

FrameFactory = Callable[[int], Frame]


def is_enabled() -> bool:
    """True when the brain should serve canned responses instead of the LLM."""
    return os.getenv("BRAIN_TEST_MODE") == "1"


def stub_message_frames(
    text: str | None,
    chat_id: str | None,
    message_id: str | None,
) -> list[FrameFactory] | None:
    """Return the canned frame factories for a recognized magic message.

    Returns ``None`` for any unrecognized input so the caller falls through to
    the real agent path. The ACK frame is sent by the caller *before* invoking
    this, so the asserted sequence is ``ACK -> <these frames>``.
    """
    t = (text or "").strip()

    if t == ECHO:
        return [
            lambda i: make_data(
                i, Op.MESSAGE, chat_id,
                {"ix": 0, "eof": False, "message": "Hello", "message_id": message_id},
            ),
            lambda i: make_data(
                i, Op.MESSAGE, chat_id,
                {"ix": 1, "eof": False, "message": " world", "message_id": message_id},
            ),
            lambda i: make_done(
                i, chat_id, {"message_id": message_id, "content": "Hello world"}
            ),
        ]

    if t == TOOL:
        return [
            lambda i: make_data(
                i, Op.MESSAGE, chat_id,
                {
                    "type": "tool_call",
                    "tool": {
                        "name": "__stub__",
                        "arguments": {"q": "ping"},
                        "result": "pong",
                    },
                    "message_id": message_id,
                },
            ),
            lambda i: make_data(
                i, Op.MESSAGE, chat_id,
                {"ix": 0, "eof": False, "message": "done", "message_id": message_id},
            ),
            lambda i: make_done(
                i, chat_id, {"message_id": message_id, "content": "done"}
            ),
        ]

    if t == ERROR:
        return [
            lambda i: make_error(i, "stub_error", chat_id, "stub error"),
        ]

    return None


def stub_task_steps() -> list[str]:
    """Return the fixed step titles for the ``__e2e_task__`` lifecycle.

    The task runner drives these through its real ``TaskEventEmitter`` so the
    persisted ``agent_task_events`` rows and ``agent_tasks`` status transitions
    (planning -> running -> done) have exactly the production shape — no risky
    keywords, so no approval gate is triggered.
    """
    return ["stub step 1", "stub step 2", "stub step 3"]
