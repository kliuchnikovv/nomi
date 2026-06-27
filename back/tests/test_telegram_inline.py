"""Tests for the Telegram inline mode (variant A).

Covers _handle_inline_query (linked / unlinked / empty), _handle_chosen_inline_result
(dispatches to the brain), and a regression that _dispatch_to_brain still publishes the
expected frame to Redis.
"""

import importlib.util
import json
import os

import pytest

from unittest.mock import AsyncMock

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
    assert card["input_message_content"]["message_text"] == "погода в Москве"


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
        {"query": "что нового", "from": {"id": 555}}
    )

    svc._dispatch_to_brain.assert_awaited_once()
    _, kwargs = svc._dispatch_to_brain.call_args
    assert kwargs["chat_id"] == 555
    assert kwargs["genie_user_id"] == "u-9"
    assert kwargs["text"] == "что нового"


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
    )

    fake_redis.publish.assert_awaited_once()
    channel, raw = fake_redis.publish.call_args[0]
    assert channel.startswith("chat:request:")
    frame = json.loads(raw)
    payload = frame["payload"]
    assert payload["source"] == "telegram"
    assert payload["telegram_chat_id"] == 12345
    assert payload["message"] == "привет"
