"""Tests for DelegationTools.delegate_to."""
import asyncio

import pytest

from src.tools.delegation import DelegationTools


class _FakeResult:
    def __init__(self, content):
        self.content = content


class _FakeAgent:
    def __init__(self, content="done", raises=None, hang=False):
        self._content = content
        self._raises = raises
        self._hang = hang

    async def arun(self, task):
        if self._hang:
            await asyncio.sleep(3600)
        if self._raises is not None:
            raise self._raises
        return _FakeResult(self._content)


def _toolkit(agent):
    return DelegationTools(registry={"sandbox_engineer": lambda: agent})


@pytest.mark.asyncio
async def test_unknown_agent_returns_error_without_building():
    built = []
    tk = DelegationTools(
        registry={"sandbox_engineer": lambda: built.append(1) or _FakeAgent()}
    )
    result = await tk.delegate_to(agent_name="nope", task="do thing")
    assert "Unknown agent" in result
    assert "sandbox_engineer" in result  # lists available targets
    assert built == []  # nothing was constructed


@pytest.mark.asyncio
async def test_known_agent_returns_final_content():
    tk = _toolkit(_FakeAgent(content="prime numbers computed"))
    result = await tk.delegate_to(agent_name="sandbox_engineer", task="run code")
    assert result == "prime numbers computed"


@pytest.mark.asyncio
@pytest.mark.parametrize("alias", ["devops", "DevOps", "  engineer  ", "developer", "sandbox"])
async def test_alias_resolves_to_sandbox_engineer(alias):
    tk = _toolkit(_FakeAgent(content="env ready"))
    result = await tk.delegate_to(agent_name=alias, task="set up the dev environment")
    assert result == "env ready"


@pytest.mark.asyncio
async def test_unknown_non_alias_still_errors():
    tk = _toolkit(_FakeAgent())
    result = await tk.delegate_to(agent_name="totally_unknown", task="x")
    assert "Unknown agent" in result
    assert "sandbox_engineer" in result


@pytest.mark.asyncio
@pytest.mark.parametrize("alias", ["developer", "opencode", "OpenCode", "  opencoder "])
async def test_developer_aliases_resolve_when_registered(alias):
    dev = _FakeAgent(content="feature shipped")
    eng = _FakeAgent(content="env ready")
    tk = DelegationTools(
        registry={"sandbox_engineer": lambda: eng, "developer": lambda: dev}
    )
    result = await tk.delegate_to(agent_name=alias, task="implement a feature")
    assert result == "feature shipped"


@pytest.mark.asyncio
async def test_developer_falls_back_to_sandbox_engineer_without_byok():
    # No "developer" in registry (no BYOK key) → fall back to sandbox_engineer.
    tk = _toolkit(_FakeAgent(content="env ready"))
    result = await tk.delegate_to(agent_name="opencode", task="implement a feature")
    assert result == "env ready"


@pytest.mark.asyncio
async def test_cancelled_error_propagates():
    tk = _toolkit(_FakeAgent(raises=asyncio.CancelledError()))
    with pytest.raises(asyncio.CancelledError):
        await tk.delegate_to(agent_name="sandbox_engineer", task="run code")


@pytest.mark.asyncio
async def test_timeout_returns_error_string(monkeypatch):
    monkeypatch.setattr("src.tools.delegation.DELEGATION_TIMEOUT", 0.01)
    tk = _toolkit(_FakeAgent(hang=True))
    result = await tk.delegate_to(agent_name="sandbox_engineer", task="run code")
    assert "time limit" in result.lower()


@pytest.mark.asyncio
async def test_subagent_exception_returns_error_string():
    tk = _toolkit(_FakeAgent(raises=RuntimeError("boom")))
    result = await tk.delegate_to(agent_name="sandbox_engineer", task="run code")
    assert "failed" in result.lower()
    assert "boom" in result
