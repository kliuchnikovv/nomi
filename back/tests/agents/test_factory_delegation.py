"""Wiring tests: AgentFactory swaps raw sandbox tool for delegate_to."""
import pytest
from unittest.mock import AsyncMock, MagicMock


class _NamedTool:
    def __init__(self, name):
        self.name = name


async def _build_and_capture(monkeypatch, built_tools):
    """Run AgentFactory.build with build_tools mocked to return built_tools.

    Returns the tools list that NomiAgent received.
    """
    monkeypatch.delenv("USE_DISCOVERY_TOOL", raising=False)

    from src.agents.factory import AgentFactory
    from src.tools.config import ToolConfigClient

    mock_config_client = MagicMock(spec=ToolConfigClient)
    mock_config_client.fetch_tools = AsyncMock(return_value=MagicMock(entries={}))
    factory = AgentFactory(db=None, model=MagicMock(), config_client=mock_config_client)
    factory.build_model = MagicMock(return_value=MagicMock())

    captured = []

    def fake_nomi(db, model, tools, **kwargs):
        captured.extend(tools)
        agent = MagicMock()
        agent.name = "nomi"
        return agent

    monkeypatch.setattr("src.agents.factory.NomiAgent", fake_nomi)
    monkeypatch.setattr(
        "src.agents.factory.build_tools", AsyncMock(return_value=list(built_tools))
    )

    await factory.build(
        session_id="sess1",
        user_id="user1",
        model_name="gemini-2.0-flash",
        client_tool_runner=AsyncMock(),
    )
    return captured


def _names(tools):
    return {getattr(t, "name", "") for t in tools}


@pytest.mark.asyncio
async def test_sandbox_present_swaps_to_delegate(monkeypatch):
    sandbox = _NamedTool("sandbox_tools")
    captured = await _build_and_capture(monkeypatch, [sandbox])
    names = _names(captured)
    assert "delegation" in names  # delegate_to toolkit was added
    assert "sandbox_tools" not in names  # raw sandbox tool was removed
    assert "background_tasks" not in names  # folded into delegate_to(background=True)
    assert sandbox not in captured


@pytest.mark.asyncio
async def test_no_sandbox_no_delegate(monkeypatch):
    captured = await _build_and_capture(monkeypatch, [])
    names = _names(captured)
    assert "delegation" not in names
    assert "sandbox_tools" not in names


@pytest.mark.asyncio
async def test_coding_model_built_for_subagents(monkeypatch):
    """When a sandbox is present, a dedicated coding model is built (CODING_MODEL)."""
    monkeypatch.delenv("USE_DISCOVERY_TOOL", raising=False)
    monkeypatch.setenv("CODING_MODEL", "gemini-2.5-flash")

    from src.agents.factory import AgentFactory
    from src.tools.config import ToolConfigClient

    mock_config_client = MagicMock(spec=ToolConfigClient)
    mock_config_client.fetch_tools = AsyncMock(return_value=MagicMock(entries={}))
    factory = AgentFactory(db=None, model=MagicMock(), config_client=mock_config_client)
    factory.build_model = MagicMock(return_value=MagicMock())

    monkeypatch.setattr(
        "src.agents.factory.NomiAgent",
        lambda db, model, tools, **kw: MagicMock(name="nomi"),
    )
    monkeypatch.setattr(
        "src.agents.factory.build_tools",
        AsyncMock(return_value=[_NamedTool("sandbox_tools")]),
    )

    await factory.build(
        session_id="s",
        user_id="u",
        model_name="gemini-2.0-flash",
        client_tool_runner=AsyncMock(),
    )

    # The dedicated coding model must have been built with thinking disabled.
    coding_calls = [
        c
        for c in factory.build_model.call_args_list
        if c.args and c.args[0] == "gemini-2.5-flash"
    ]
    assert coding_calls, "expected build_model('gemini-2.5-flash', ...) to be called"
    assert coding_calls[0].kwargs.get("thinking") == "off"
