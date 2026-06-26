"""Tests for the shared chat-recap helpers (src/server/recap.py).

Covers transcript building, tail truncation, and the cache/generation decision
in ``generate_recap`` — all without importing the heavy FastAPI app.
"""

from __future__ import annotations

import pytest

from src.server import recap


# ── messages_to_text ────────────────────────────────────────────────


def test_messages_to_text_builds_transcript():
    msgs = [
        {"role": "user", "text": "Hi"},
        {"role": "assistant", "text": "Hello"},
        {"role": "user", "text": "Bye"},
    ]
    out = recap.messages_to_text(msgs)
    assert out == "USER: Hi\nASSISTANT: Hello\nUSER: Bye"


def test_messages_to_text_skips_empty_and_supports_content_key():
    msgs = [
        {"role": "user", "text": "  "},
        {"role": "assistant", "content": "from content"},
        {"role": "user", "text": None},
    ]
    out = recap.messages_to_text(msgs)
    assert out == "ASSISTANT: from content"


def test_messages_to_text_empty():
    assert recap.messages_to_text([]) == ""


def test_messages_to_text_truncates_tail():
    long_text = "x" * (recap._MAX_CHARS + 5_000)
    out = recap.messages_to_text([{"role": "user", "text": long_text}])
    assert out.startswith("[…earlier turns truncated…]\n")
    # Body bounded to _MAX_CHARS after the marker.
    assert len(out) <= recap._MAX_CHARS + len("[…earlier turns truncated…]\n")


# ── generate_recap ──────────────────────────────────────────────────


class _FakeModel:
    async def aresponse(self, messages):  # noqa: D401
        return type("R", (), {"content": "SUMMARY"})()


def _build_model(_name):
    return _FakeModel()


@pytest.mark.asyncio
async def test_generate_recap_cache_hit():
    flags = {"chat_recap": "cached recap", "chat_recap_msg_count": 2}
    messages = [{"role": "user", "text": "a"}, {"role": "assistant", "text": "b"}]
    recap_text, cached, updates = await recap.generate_recap(
        messages, flags, _build_model
    )
    assert cached is True
    assert recap_text == "cached recap"
    assert updates is None


@pytest.mark.asyncio
async def test_generate_recap_regenerates_on_count_change():
    # Cached count (1) differs from current (2) → regenerate.
    flags = {"chat_recap": "old", "chat_recap_msg_count": 1}
    messages = [{"role": "user", "text": "a"}, {"role": "assistant", "text": "b"}]
    recap_text, cached, updates = await recap.generate_recap(
        messages, flags, _build_model
    )
    assert cached is False
    assert recap_text == "SUMMARY"
    assert updates == {"chat_recap": "SUMMARY", "chat_recap_msg_count": 2}


@pytest.mark.asyncio
async def test_generate_recap_fresh_no_cache():
    messages = [{"role": "user", "text": "hello"}]
    recap_text, cached, updates = await recap.generate_recap(messages, {}, _build_model)
    assert cached is False
    assert recap_text == "SUMMARY"
    assert updates["chat_recap_msg_count"] == 1


@pytest.mark.asyncio
async def test_generate_recap_empty_transcript():
    messages = [{"role": "user", "text": "   "}]
    recap_text, cached, updates = await recap.generate_recap(messages, {}, _build_model)
    assert recap_text == ""
    assert cached is False
    assert updates is None
