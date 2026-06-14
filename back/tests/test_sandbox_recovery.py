"""Tests for sandbox destroyed-state recovery.

Covers the fix for idle Railway sandboxes that are auto-destroyed while their id
is still cached: the sidecar may return a 5xx whose body says the sandbox is
"not running (status: DESTROYED)" instead of a clean 404. The Python client must
treat that as a not-found (so SandboxTools recreates), and the generic
``_with_retry`` wrapper must recreate-and-retry once for every op.

The sandbox plugin lives at repo-root ``plugins/sandbox/server`` and is loaded by
the plugin loader at runtime (``plugins.sandbox`` has no ``__init__``), so we load
the two modules by file path and register them under their runtime names.
"""

import importlib.util
import os
import sys
import types
from unittest.mock import AsyncMock

import pytest

_PLUGIN_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "plugins", "sandbox", "server")
)


def _load(mod_name: str, filename: str):
    spec = importlib.util.spec_from_file_location(
        mod_name, os.path.join(_PLUGIN_DIR, filename)
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)
    return mod


# Stub the non-package parents so `from plugins.sandbox.server.service import ...`
# inside tools.py resolves to our path-loaded module (agno.tools is mocked by conftest).
for _pkg in ("plugins", "plugins.sandbox", "plugins.sandbox.server"):
    sys.modules.setdefault(_pkg, types.ModuleType(_pkg))

service = _load("plugins.sandbox.server.service", "service.py")
tools = _load("plugins.sandbox.server.tools", "tools.py")

SandboxNotFoundError = service.SandboxNotFoundError
SandboxService = service.SandboxService
SandboxTools = tools.SandboxTools


# ── service._is_dead_sandbox_body ──────────────────────────────────────────


@pytest.mark.parametrize(
    "text",
    [
        "tcp-proxy files WebSocket closed (code 1008: Sandbox is not running "
        "(status: DESTROYED)).",
        "status: DESTROYING",
        "SandboxFailedError: status=FAILED",
        "is not running",
    ],
)
def test_dead_body_detected(text):
    assert service._is_dead_sandbox_body(text) is True


@pytest.mark.parametrize("text", ["", "Failed to list files: permission denied", "boom"])
def test_live_body_not_flagged(text):
    assert service._is_dead_sandbox_body(text) is False


# ── service.exec_command maps a dead-state 5xx to SandboxNotFoundError ──────


class _FakeResp:
    def __init__(self, status: int, text: str):
        self.status = status
        self._text = text

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def json(self):
        return {}

    async def text(self):
        return self._text


class _FakeSession:
    """aiohttp.ClientSession stand-in returning a canned response for post/get."""

    def __init__(self, resp: _FakeResp):
        self._resp = resp

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def post(self, *a, **k):
        return self._resp

    def get(self, *a, **k):
        return self._resp


@pytest.mark.asyncio
async def test_exec_command_dead_500_raises_not_found(monkeypatch):
    resp = _FakeResp(
        500,
        "Sandbox is not running (status: DESTROYED).",
    )
    monkeypatch.setattr(
        service.aiohttp, "ClientSession", lambda *a, **k: _FakeSession(resp)
    )
    svc = SandboxService()
    with pytest.raises(SandboxNotFoundError):
        await svc.exec_command("sb-123", ["echo", "hi"])


@pytest.mark.asyncio
async def test_exec_command_real_500_raises_generic(monkeypatch):
    resp = _FakeResp(500, "Failed to execute command: disk full")
    monkeypatch.setattr(
        service.aiohttp, "ClientSession", lambda *a, **k: _FakeSession(resp)
    )
    svc = SandboxService()
    with pytest.raises(Exception) as ei:
        await svc.exec_command("sb-123", ["echo", "hi"])
    assert not isinstance(ei.value, SandboxNotFoundError)


# ── tools._with_retry recreates the sandbox once on not-found ───────────────


@pytest.mark.asyncio
async def test_with_retry_recreates_once_then_succeeds():
    st = SandboxTools(user_id="u1", project_id="p1")

    # Fake service: hands out a new id each create; clears nothing of its own.
    created_ids = iter(["sb-old", "sb-new"])
    fake = type("S", (), {})()
    fake.get_or_create_sandbox = AsyncMock(side_effect=lambda *a, **k: next(created_ids))
    fake.clear_cache_for_user = lambda *a, **k: None
    st._service = fake

    calls: list[str] = []

    async def op(sandbox_id: str):
        calls.append(sandbox_id)
        if sandbox_id == "sb-old":
            raise SandboxNotFoundError("gone")
        return {"ok": True}

    result = await st._with_retry(op)

    assert result == {"ok": True}
    assert calls == ["sb-old", "sb-new"]  # retried against the recreated sandbox
    assert st._sandbox_id == "sb-new"


@pytest.mark.asyncio
async def test_with_retry_propagates_if_recreate_also_fails():
    st = SandboxTools(user_id="u1", project_id="p1")
    fake = type("S", (), {})()
    fake.get_or_create_sandbox = AsyncMock(return_value="sb-x")
    fake.clear_cache_for_user = lambda *a, **k: None
    st._service = fake

    async def op(sandbox_id: str):
        raise SandboxNotFoundError("still gone")

    with pytest.raises(SandboxNotFoundError):
        await st._with_retry(op)
