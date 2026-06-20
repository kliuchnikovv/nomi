import pytest

from src.commands.context import CommandContext


@pytest.mark.asyncio
async def test_emit_invokes_callback():
    emitted = []

    async def emit(frame):
        emitted.append(frame)

    ctx = CommandContext(
        user_id="u1",
        session_id="s1",
        chat_id="c1",
        tools_config=None,
        knowledge=None,
        emit=emit,
        client_tool_runner=None,
    )

    await ctx.emit({"kind": "data", "payload": {"type": "text", "message": "hi"}})
    assert emitted == [{"kind": "data", "payload": {"type": "text", "message": "hi"}}]
