"""E2E: an error frame is surfaced, and the system still serves later requests."""

import assertions as A
from client import ChatClient


async def _new_chat(api) -> str:
    return (await api.post("/api/chats", json={"title": "e2e", "mode": "agent"})).json()["id"]


async def test_error_frame_then_recovery(base_url, auth, api):
    # 1. The error scenario yields a terminal error frame (not a hang).
    err_chat = await _new_chat(api)
    async with ChatClient(base_url, auth["token"], err_chat) as chat:
        await chat.send_message("__e2e_error__")
        frames = await chat.collect_until_done(timeout=30)

    last = frames[-1]
    assert last.get("op") == "error", A.ops(frames)
    assert (last.get("error") or {}).get("code") == "stub_error", last

    # 2. A subsequent normal request on a fresh chat still completes — the worker
    #    and hub recover cleanly from the error turn.
    ok_chat = await _new_chat(api)
    async with ChatClient(base_url, auth["token"], ok_chat) as chat:
        await chat.send_message("__e2e_echo__")
        frames = await chat.collect_until_done(timeout=30)

    assert A.assembled_text(frames) == "Hello world"
    A.assert_terminal_done(frames)
