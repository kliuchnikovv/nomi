"""Tests for SandboxTools.ensure_git_auth().

The sandbox engineer often runs raw ``git clone <url>`` via ``exec_command``
instead of the dedicated ``clone_repo`` tool, so git received no credentials and
failed with "could not read Username". ``ensure_git_auth`` provisions a global,
host-scoped ``credential.<url>.helper`` in the sandbox's ~/.gitconfig so EVERY
github.com git op is authenticated. The sandbox's ``safe-git`` wrapper rejects
``git config`` writes outside ``user.*``/``credential.*``, so a credential
helper is the only namespace that works. These tests pin that behaviour without
a real sandbox.

The sandbox plugin lives at repo-root ``plugins/sandbox/server`` and is loaded by
the plugin loader at runtime, so we load the modules by file path (mirroring
``tests/test_sandbox_recovery.py``).
"""

import importlib.util
import os
import sys
import types

import pytest

_PLUGIN_DIR = os.path.normpath(
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "plugins", "sandbox", "server"
    )
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
tools = _load("plugins.sandbox.server.tools", "tools.py")

SandboxTools = tools.SandboxTools


def _expected_helper(token: str) -> str:
    return (
        "!f() { echo username=x-access-token; "
        f"echo password={token}; }}; f"
    )


class _RecordingService:
    """Fake service that records every exec_command and returns exit_code 0."""

    def __init__(self):
        self.commands: list[list[str]] = []
        self.exit_code = 0

    async def exec_command(self, sandbox_id, command, timeout=60, stream=False):
        self.commands.append(command)
        return {"stdout": "", "stderr": "", "exit_code": self.exit_code}

    def clear_cache_for_user(self, *a, **k):
        return None


def _make_tools(token: str) -> tuple[SandboxTools, _RecordingService]:
    st = SandboxTools(user_id="u1", project_id="p1", github_token=token)
    fake = _RecordingService()
    st._service = fake
    st._sandbox_id = "sb-1"  # preset so no create call is needed
    return st, fake


def _config_commands(fake: _RecordingService) -> list[list[str]]:
    return [c for c in fake.commands if c[:3] == ["git", "config", "--global"]]


@pytest.mark.asyncio
async def test_ensure_git_auth_issues_global_config():
    st, fake = _make_tools("tok123")
    await st.ensure_git_auth()

    assert fake.commands == [
        [
            "git",
            "config",
            "--global",
            "--replace-all",
            "credential.https://github.com.helper",
            _expected_helper("tok123"),
        ]
    ]
    assert st._git_auth_token == "tok123"


@pytest.mark.asyncio
async def test_ensure_git_auth_idempotent_per_token():
    st, fake = _make_tools("tok123")
    await st.ensure_git_auth()
    await st.ensure_git_auth()

    assert len(_config_commands(fake)) == 1


@pytest.mark.asyncio
async def test_ensure_git_auth_skips_when_token_empty():
    st, fake = _make_tools("")
    await st.ensure_git_auth()
    await st.ensure_git_auth()

    assert fake.commands == []
    assert st._git_auth_token == ""


@pytest.mark.asyncio
async def test_ensure_git_auth_rewrites_on_token_change():
    st, fake = _make_tools("tok1")
    await st.ensure_git_auth()
    st.github_token = "tok2"
    await st.ensure_git_auth()

    configs = _config_commands(fake)
    assert len(configs) == 2
    assert configs[1][-1] == _expected_helper("tok2")
    assert st._git_auth_token == "tok2"


@pytest.mark.asyncio
async def test_exec_command_provisions_before_running():
    st, fake = _make_tools("tok123")
    await st.exec_command(["git", "clone", "https://github.com/o/r"])

    assert len(fake.commands) == 2
    assert fake.commands[0][:3] == ["git", "config", "--global"]
    assert fake.commands[1] == ["git", "clone", "https://github.com/o/r"]


@pytest.mark.asyncio
async def test_ensure_git_auth_not_marked_done_on_failure():
    st, fake = _make_tools("tok123")
    fake.exit_code = 1
    await st.ensure_git_auth()

    # Failed write must not be cached, so a later call retries.
    assert st._git_auth_token is None
    await st.ensure_git_auth()
    assert len(_config_commands(fake)) == 2
