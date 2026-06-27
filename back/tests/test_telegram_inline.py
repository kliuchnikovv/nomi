"""Tests for the Telegram inline mode (variant A).

Covers _handle_inline_query (linked / unlinked / empty), _handle_chosen_inline_result
(dispatches to the brain), and a regression that _dispatch_to_brain still publishes the
expected frame to Redis.
"""

import importlib.util
import json
import os
import sys
import types

import pytest

from unittest.mock import AsyncMock, MagicMock

# The plugin lives at the repo root, outside back/'s import path, and `plugins`
# is a namespace package that can clash during full-suite collection. Load the
# service module directly from its file to stay isolated.
_SERVICE_PATH = os.path.normpath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "plugins",
        "telegram",
        "server",
        "service.py",
    )
)
_spec = importlib.util.spec_from_file_location(
    "telegram_service_under_test", _SERVICE_PATH
)
_service_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_service_mod)
TelegramService = _service_mod.TelegramService

_DELIVERY_PATH = os.path.normpath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "plugins",
        "telegram",
        "server",
        "delivery.py",
    )
)


def _load_delivery_handler():
    spec = importlib.util.spec_from_file_location(
        "telegram_delivery_under_test", _DELIVERY_PATH
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.TelegramDeliveryHandler()


def _install_fake_service(monkeypatch, svc):
    """Wire a fake service so delivery's lazy ``from plugins...import get_service`` resolves."""
    for name in ("plugins", "plugins.telegram", "plugins.telegram.server"):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
    leaf = types.ModuleType("plugins.telegram.server.service")
    leaf.get_service = lambda: svc
    monkeypatch.setitem(sys.modules, "plugins.telegram.server.service", leaf)


def _make_service() -> TelegramService:
    svc = TelegramService()
    svc.bot_token = "test-token"
    svc.base_url = "https://api.telegram.org/bottest-token"
    return svc


# ── _handle_inline_query ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_inline_query_linked_returns_card():
    svc = _make_service()
    svc._find_linked_account_by_user = AsyncMock(
        return_value={"user_id": "u-1", "data": {"active": True}}
    )
    svc.answer_inline_query = AsyncMock()

    await svc._handle_inline_query(
        {"id": "q1", "query": "погода в Москве", "from": {"id": 777}}
    )

    args, kwargs = svc.answer_inline_query.call_args
    query_id, results = args[0], args[1]
    assert query_id == "q1"
    assert len(results) == 1
    card = results[0]
    assert card["type"] == "article"
    # Placeholder shows the question; the answer replaces it later via edit.
    assert "погода в Москве" in card["input_message_content"]["message_text"]
    # An inline keyboard is required so Telegram returns inline_message_id.
    assert card["reply_markup"]["inline_keyboard"]


@pytest.mark.asyncio
async def test_inline_query_unlinked_shows_connect_button():
    svc = _make_service()
    svc._find_linked_account_by_user = AsyncMock(return_value=None)
    svc.answer_inline_query = AsyncMock()

    await svc._handle_inline_query(
        {"id": "q2", "query": "hi", "from": {"id": 888}}
    )

    args, kwargs = svc.answer_inline_query.call_args
    assert args[1] == []  # no results
    assert kwargs.get("switch_pm_text")
    assert kwargs.get("switch_pm_parameter") == "connect"


@pytest.mark.asyncio
async def test_inline_query_empty_text_returns_no_results():
    svc = _make_service()
    svc._find_linked_account_by_user = AsyncMock(
        return_value={"user_id": "u-1", "data": {"active": True}}
    )
    svc.answer_inline_query = AsyncMock()

    await svc._handle_inline_query({"id": "q3", "query": "   ", "from": {"id": 777}})

    args, kwargs = svc.answer_inline_query.call_args
    assert args[1] == []
    assert "switch_pm_text" not in kwargs


# ── _handle_chosen_inline_result ──────────────────────────────────────


@pytest.mark.asyncio
async def test_chosen_inline_result_dispatches_to_brain():
    svc = _make_service()
    account = {"user_id": "u-9", "data": {"active": True}}
    svc._find_linked_account_by_user = AsyncMock(return_value=account)
    svc._dispatch_to_brain = AsyncMock()

    await svc._handle_chosen_inline_result(
        {"query": "что нового", "from": {"id": 555}, "inline_message_id": "im-7"}
    )

    svc._dispatch_to_brain.assert_awaited_once()
    _, kwargs = svc._dispatch_to_brain.call_args
    assert kwargs["chat_id"] == 555
    assert kwargs["genie_user_id"] == "u-9"
    assert kwargs["text"] == "что нового"
    assert kwargs["inline_message_id"] == "im-7"


@pytest.mark.asyncio
async def test_chosen_inline_result_ignored_when_unlinked():
    svc = _make_service()
    svc._find_linked_account_by_user = AsyncMock(return_value=None)
    svc._dispatch_to_brain = AsyncMock()

    await svc._handle_chosen_inline_result(
        {"query": "hi", "from": {"id": 555}}
    )

    svc._dispatch_to_brain.assert_not_called()


# ── _dispatch_to_brain (regression) ───────────────────────────────────


@pytest.mark.asyncio
async def test_dispatch_to_brain_publishes_frame():
    svc = _make_service()

    conn = AsyncMock()
    conn.fetch = AsyncMock(return_value=[])
    conn.execute = AsyncMock()
    conn.close = AsyncMock()
    svc._get_db_conn = AsyncMock(return_value=conn)

    fake_redis = AsyncMock()
    fake_redis.publish = AsyncMock()
    svc._get_redis = AsyncMock(return_value=fake_redis)

    await svc._dispatch_to_brain(
        chat_id=12345,
        genie_user_id="u-1",
        data={"selected_model": ""},
        text="привет",
        inline_message_id="im-3",
        inline_query="привет",
    )

    fake_redis.publish.assert_awaited_once()
    channel, raw = fake_redis.publish.call_args[0]
    assert channel.startswith("chat:request:")
    frame = json.loads(raw)
    payload = frame["payload"]
    assert payload["source"] == "telegram"
    assert payload["telegram_chat_id"] == 12345
    assert payload["message"] == "привет"
    assert payload["telegram_inline_message_id"] == "im-3"
    # Inline → lightweight public "group" agent (no personal data).
    assert payload["agent_type"] == "group"


@pytest.mark.asyncio
async def test_dispatch_agent_type_group_for_negative_chat_id():
    svc = _make_service()
    conn = AsyncMock()
    conn.fetch = AsyncMock(return_value=[])
    conn.execute = AsyncMock()
    conn.close = AsyncMock()
    svc._get_db_conn = AsyncMock(return_value=conn)
    fake_redis = AsyncMock()
    fake_redis.publish = AsyncMock()
    svc._get_redis = AsyncMock(return_value=fake_redis)

    # Negative chat id == Telegram group/supergroup.
    await svc._dispatch_to_brain(
        chat_id=-100200, genie_user_id="u-1", data={}, text="вопрос"
    )
    payload = json.loads(fake_redis.publish.call_args[0][1])["payload"]
    assert payload["agent_type"] == "group"


@pytest.mark.asyncio
async def test_dispatch_agent_type_nomi_for_private_chat():
    svc = _make_service()
    conn = AsyncMock()
    conn.fetch = AsyncMock(return_value=[])
    conn.execute = AsyncMock()
    conn.close = AsyncMock()
    svc._get_db_conn = AsyncMock(return_value=conn)
    fake_redis = AsyncMock()
    fake_redis.publish = AsyncMock()
    svc._get_redis = AsyncMock(return_value=fake_redis)

    # Positive chat id, no inline → private 1:1 chat keeps the full personal agent.
    await svc._dispatch_to_brain(
        chat_id=12345, genie_user_id="u-1", data={}, text="привет"
    )
    payload = json.loads(fake_redis.publish.call_args[0][1])["payload"]
    assert payload["agent_type"] == "nomi"


# ── TelegramDeliveryHandler (inline vs direct) ────────────────────────


@pytest.mark.asyncio
async def test_delivery_edits_inline_message_in_place(monkeypatch):
    handler = _load_delivery_handler()

    svc = MagicMock()
    svc.enabled = True
    svc.edit_inline_message = AsyncMock()
    svc.send_message = AsyncMock()
    svc.save_assistant_message = AsyncMock()
    _install_fake_service(monkeypatch, svc)

    await handler.deliver(
        "ответ от ИИ",
        {
            "telegram_inline_message_id": "im-1",
            "telegram_inline_query": "вопрос",
            "telegram_chat_id": 42,
            "user_id": "u-1",
        },
    )

    svc.send_message.assert_not_called()
    svc.edit_inline_message.assert_awaited_once()
    edited_id, body = svc.edit_inline_message.call_args[0][:2]
    assert edited_id == "im-1"
    assert "вопрос" in body and "ответ от ИИ" in body


@pytest.mark.asyncio
async def test_delivery_falls_back_to_send_message_without_inline(monkeypatch):
    handler = _load_delivery_handler()

    svc = MagicMock()
    svc.enabled = True
    svc.edit_inline_message = AsyncMock()
    svc.send_message = AsyncMock()
    svc.save_assistant_message = AsyncMock()
    _install_fake_service(monkeypatch, svc)

    await handler.deliver(
        "ответ",
        {"telegram_chat_id": 42, "user_id": "u-1"},
    )

    svc.edit_inline_message.assert_not_called()
    svc.send_message.assert_awaited_once()
    assert svc.send_message.call_args[0][0] == 42
