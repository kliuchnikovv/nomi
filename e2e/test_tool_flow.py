"""E2E: a tool_call frame is delivered with the expected shape before DONE."""

import assertions as A
from client import ChatClient


async def test_tool_call_frame_shape(base_url, auth, api):
    chat_id = (await api.post("/api/chats", json={"title": "e2e", "mode": "agent"})).json()["id"]

    async with ChatClient(base_url, auth["token"], chat_id) as chat:
        await chat.send_message("__e2e_tool__")
        frames = await chat.collect_until_done(timeout=30)

    tool_frames = A.tool_call_frames(frames)
    assert len(tool_frames) == 1, A.ops(frames)
    tool = A.payload(tool_frames[0])["tool"]
    assert tool["name"] == "__stub__"
    assert "arguments" in tool and "result" in tool

    # The tool_call must precede the terminal DONE, and text still streams after.
    assert A.assembled_text(frames) == "done"
    A.assert_terminal_done(frames)
