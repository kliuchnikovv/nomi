"""E2E: the core chat message contract over the real Go <-> Redis <-> brain path."""

import asyncio

import assertions as A
from client import ChatClient


async def _create_chat(api) -> str:
    resp = await api.post("/api/chats", json={"title": "e2e", "mode": "agent"})
    resp.raise_for_status()
    return resp.json()["id"]


async def _get_messages(api, chat_id: str) -> list[dict]:
    resp = await api.get(f"/api/chats/{chat_id}/messages")
    resp.raise_for_status()
    return resp.json()


async def test_echo_frame_sequence_and_persistence(base_url, auth, api):
    chat_id = await _create_chat(api)

    async with ChatClient(base_url, auth["token"], chat_id) as chat:
        await chat.send_message("__e2e_echo__")
        frames = await chat.collect_until_done(timeout=30)

    # Contract: pickup ACK, then the two stub text deltas, then a terminal DONE.
    assert "ack" in A.ops(frames), A.ops(frames)
    deltas = [A.payload(f)["message"] for f in A.text_frames(frames)]
    assert deltas == ["Hello", " world"], deltas
    done = A.assert_terminal_done(frames)
    assert A.payload(done).get("content") == "Hello world"

    # Persistence: user message + assembled assistant reply land in the DB. The
    # assistant row is written on DONE; poll briefly to avoid a write race.
    for _ in range(10):
        msgs = await _get_messages(api, chat_id)
        texts = [m.get("text", "") for m in msgs]
        if any("__e2e_echo__" in t for t in texts) and any("Hello world" in t for t in texts):
            break
        await asyncio.sleep(0.5)
    else:
        raise AssertionError(f"messages not persisted as expected: {texts}")

    roles = {m.get("role") for m in msgs}
    assert "user" in roles and "assistant" in roles, roles
