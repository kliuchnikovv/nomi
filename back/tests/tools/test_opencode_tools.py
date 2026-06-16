"""Tests for OpenCodeTools (opencode CLI provisioning + run in the sandbox)."""
import importlib.util
import json
import os
import sys
import types

import pytest

# The sandbox plugin lives at repo-root plugins/sandbox/server and is loaded by
# the plugin loader at runtime (no __init__). Load the modules by file path and
# register them under their runtime names, mirroring test_sandbox_recovery.py.
_PLUGIN_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "plugins", "sandbox", "server")
)


def _load(mod_name: str, filename: str):
    spec = importlib.util.spec_from_file_location(
        mod_name, os.path.join(_PLUGIN_DIR, filename)
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)
    return mod


for _pkg in ("plugins", "plugins.sandbox", "plugins.sandbox.server"):
    sys.modules.setdefault(_pkg, types.ModuleType(_pkg))

_load("plugins.sandbox.server.service", "service.py")
_load("plugins.sandbox.server.tools", "tools.py")
_opencode = _load("plugins.sandbox.server.opencode_tools", "opencode_tools.py")

DEFAULT_MODELS = _opencode.DEFAULT_MODELS
OpenCodeTools = _opencode.OpenCodeTools


class _FakeSandbox:
    """Minimal stand-in for SandboxTools recording exec/upload calls."""

    def __init__(self, opencode_installed=False):
        self.sandbox_id = "sbx-1"
        self.exec_calls = []
        self.uploads = {}
        self._installed = opencode_installed

    async def _get_sandbox(self):
        return self.sandbox_id

    async def _exec_with_retry(self, command, timeout=60, stream=False):
        self.exec_calls.append(command)
        joined = " ".join(command)
        if "command -v opencode" in joined:
            return {"stdout": "/usr/bin/opencode" if self._installed else "", "exit_code": 0}
        if "echo $HOME" in joined:
            return {"stdout": "/root\n", "exit_code": 0}
        return {"stdout": "", "stderr": "", "exit_code": 0}

    async def upload_file(self, path, content):
        self.uploads[path] = content
        return True


@pytest.mark.asyncio
async def test_run_opencode_no_byok_returns_error():
    sb = _FakeSandbox()
    tk = OpenCodeTools(sandbox_tools=sb, byok_keys={})
    result = await tk.run_opencode(task="do thing")
    assert result["exit_code"] == 1
    assert "BYOK" in result["error"]
    assert sb.exec_calls == []  # nothing provisioned/run


@pytest.mark.asyncio
async def test_default_provider_picked_by_priority():
    sb = _FakeSandbox()
    tk = OpenCodeTools(sandbox_tools=sb, byok_keys={"google": "g", "anthropic": "a"})
    # anthropic outranks google in PROVIDER_PRIORITY.
    assert tk._default == "anthropic"


@pytest.mark.asyncio
async def test_run_opencode_builds_command_with_default_model():
    sb = _FakeSandbox(opencode_installed=True)
    tk = OpenCodeTools(sandbox_tools=sb, byok_keys={"anthropic": "sk-ant"}, byok_default="anthropic")
    await tk.run_opencode(task="write a hello world")

    run_cmds = [" ".join(c) for c in sb.exec_calls if "opencode run" in " ".join(c)]
    assert len(run_cmds) == 1
    assert DEFAULT_MODELS["anthropic"] in run_cmds[0]
    assert "write a hello world" in run_cmds[0]


@pytest.mark.asyncio
async def test_ensure_writes_auth_json_and_is_idempotent():
    sb = _FakeSandbox(opencode_installed=True)
    tk = OpenCodeTools(sandbox_tools=sb, byok_keys={"anthropic": "sk-ant", "zai": "zk"}, byok_default="anthropic")

    await tk.ensure_opencode()
    auth_path = "/root/.local/share/opencode/auth.json"
    assert auth_path in sb.uploads
    auth = json.loads(sb.uploads[auth_path])
    assert auth["anthropic"] == {"type": "api", "key": "sk-ant"}
    assert auth["zai"]["key"] == "zk"
    # z.ai needs a custom provider config.
    assert "/root/.config/opencode/opencode.json" in sb.uploads

    # Second call with unchanged keys/sandbox must not re-provision.
    calls_before = len(sb.exec_calls)
    await tk.ensure_opencode()
    assert len(sb.exec_calls) == calls_before


@pytest.mark.asyncio
async def test_ensure_installs_when_missing():
    sb = _FakeSandbox(opencode_installed=False)
    tk = OpenCodeTools(sandbox_tools=sb, byok_keys={"anthropic": "sk-ant"})
    await tk.ensure_opencode()
    assert any("opencode.ai/install" in " ".join(c) for c in sb.exec_calls)
