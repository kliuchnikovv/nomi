"""/list handler — show/add/rm/del/clear over an in-memory fake store."""

from __future__ import annotations

import asyncio

import pytest

from src.server.models import Frame, Kind, Op
from src.server.slash_commands import SlashCommandContext, dispatch
from src.server.slash_commands.handlers import lists as lists_handler


class _FakeLists:
    """In-memory stand-in for src.storage.user_lists, keyed by (user_id, name)."""

    def __init__(self) -> None:
        self.data: dict[tuple[str, str], list[str]] = {}

    async def get_lists(self, user_id):
        out = []
        for (uid, name), items in sorted(self.data.items()):
            if uid == user_id:
                out.append({"name": name, "items": list(items), "count": len(items)})
        return out

    async def get_list(self, user_id, name):
        if (user_id, name) not in self.data:
            return None
        items = self.data[(user_id, name)]
        return {"name": name, "items": list(items), "count": len(items)}

    async def add_item(self, user_id, name, item):
        self.data.setdefault((user_id, name), []).append(item)
        items = self.data[(user_id, name)]
        return {"name": name, "items": list(items), "count": len(items)}

    async def remove_item(self, user_id, name, ref):
        if (user_id, name) not in self.data:
            return None, None
        items = self.data[(user_id, name)]
        idx = None
        ref = ref.strip()
        if ref.lstrip("-").isdigit():
            n = int(ref)
            if 1 <= n <= len(items):
                idx = n - 1
        if idx is None:
            for i, it in enumerate(items):
                if it.lower() == ref.lower():
                    idx = i
                    break
        if idx is None:
            return None, {"name": name, "items": list(items), "count": len(items)}
        removed = items.pop(idx)
        return removed, {"name": name, "items": list(items), "count": len(items)}

    async def delete_list(self, user_id, name):
        return self.data.pop((user_id, name), None) is not None

    async def clear_list(self, user_id, name):
        if (user_id, name) not in self.data:
            return False
        self.data[(user_id, name)] = []
        return True


@pytest.fixture
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def fake_store(monkeypatch):
    store = _FakeLists()
    monkeypatch.setattr(lists_handler, "_lists", store)
    return store


def _make_ctx(user_id: str | None = "user-1") -> tuple[SlashCommandContext, list[Frame]]:
    sent: list[Frame] = []
    next_id = {"n": 0}

    async def send_frame(frame: Frame):
        sent.append(frame)
        next_id["n"] += 1
        return next_id["n"]

    ctx = SlashCommandContext(
        user_id=user_id,
        chat_id="chat-1",
        session_id="sess-1",
        payload={},
        agent_storage_mode="agno",
        send_frame=send_frame,
        next_id_fn=lambda: next_id["n"],
        redis_client=None,
    )
    return ctx, sent


def _first_text(sent: list[Frame]) -> str:
    return next(f.payload["message"] for f in sent if f.op == Op.MESSAGE)


@pytest.mark.asyncio
async def test_no_lists(fake_store):
    ctx, sent = _make_ctx()
    await dispatch("/list", ctx)
    assert "No lists yet" in _first_text(sent)
    assert [(f.kind, f.op) for f in sent][-1] == (Kind.DATA, Op.DONE)


@pytest.mark.asyncio
async def test_add_creates_and_appends(fake_store):
    ctx, sent = _make_ctx()
    await dispatch("/list add groceries milk", ctx)
    assert fake_store.data[("user-1", "groceries")] == ["milk"]
    assert "Added to 'groceries': milk" in _first_text(sent)

    ctx, sent = _make_ctx()
    await dispatch("/list add groceries eggs and bread", ctx)
    assert fake_store.data[("user-1", "groceries")] == ["milk", "eggs and bread"]
    assert "now 2 items" in _first_text(sent)


@pytest.mark.asyncio
async def test_show_all_and_one(fake_store):
    fake_store.data[("user-1", "groceries")] = ["milk", "eggs"]
    fake_store.data[("user-1", "todo")] = ["call mom"]

    ctx, sent = _make_ctx()
    await dispatch("/list", ctx)
    body = _first_text(sent)
    assert "groceries (2)" in body
    assert "todo (1)" in body

    ctx, sent = _make_ctx()
    await dispatch("/list groceries", ctx)
    body = _first_text(sent)
    assert "1. milk" in body
    assert "2. eggs" in body


@pytest.mark.asyncio
async def test_remove_by_index(fake_store):
    fake_store.data[("user-1", "groceries")] = ["milk", "eggs", "bread"]
    ctx, sent = _make_ctx()
    await dispatch("/list rm groceries 2", ctx)
    assert fake_store.data[("user-1", "groceries")] == ["milk", "bread"]
    assert "Removed from 'groceries': eggs" in _first_text(sent)


@pytest.mark.asyncio
async def test_remove_by_text(fake_store):
    fake_store.data[("user-1", "groceries")] = ["milk", "eggs"]
    ctx, sent = _make_ctx()
    await dispatch("/list rm groceries MILK", ctx)
    assert fake_store.data[("user-1", "groceries")] == ["eggs"]
    assert "Removed from 'groceries': milk" in _first_text(sent)


@pytest.mark.asyncio
async def test_remove_no_match(fake_store):
    fake_store.data[("user-1", "groceries")] = ["milk"]
    ctx, sent = _make_ctx()
    await dispatch("/list rm groceries nope", ctx)
    assert "Nothing matching" in _first_text(sent)


@pytest.mark.asyncio
async def test_delete_and_clear(fake_store):
    fake_store.data[("user-1", "groceries")] = ["milk"]
    fake_store.data[("user-1", "todo")] = ["x", "y"]

    ctx, sent = _make_ctx()
    await dispatch("/list clear todo", ctx)
    assert fake_store.data[("user-1", "todo")] == []
    assert "Cleared 'todo'" in _first_text(sent)

    ctx, sent = _make_ctx()
    await dispatch("/list del groceries", ctx)
    assert ("user-1", "groceries") not in fake_store.data
    assert "Deleted list 'groceries'" in _first_text(sent)


@pytest.mark.asyncio
async def test_unknown_list_shows_usage(fake_store):
    ctx, sent = _make_ctx()
    await dispatch("/list nonexistent", ctx)
    body = _first_text(sent)
    assert "No list named 'nonexistent'" in body
    assert "Usage:" in body


@pytest.mark.asyncio
async def test_missing_user(fake_store):
    ctx, sent = _make_ctx(user_id=None)
    await dispatch("/list", ctx)
    assert "signed-in user" in _first_text(sent)


@pytest.mark.asyncio
async def test_help_lists_command(fake_store):
    ctx, sent = _make_ctx()
    await dispatch("/help", ctx)
    assert "/list" in _first_text(sent)
