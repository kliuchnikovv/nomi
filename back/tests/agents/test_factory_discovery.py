# back/tests/agents/test_factory_discovery.py
import pytest
from unittest.mock import AsyncMock, MagicMock
from agno.tools import Function


@pytest.mark.asyncio
async def test_factory_builds_only_discovery_tool_when_flag_set(monkeypatch):
    """When USE_DISCOVERY_TOOL=1, agent receives exactly one tool: discovery_tool."""
    monkeypatch.setenv("USE_DISCOVERY_TOOL", "1")

    mock_fn = MagicMock(spec=Function)
    mock_fn.name = "discovery_tool"
    monkeypatch.setattr(
        "src.agents.factory.build_discovery_tool",
        lambda **kwargs: mock_fn,
    )

    from src.agents.factory import AgentFactory
    from src.tools.config import ToolConfigClient

    mock_config_client = MagicMock(spec=ToolConfigClient)
    factory = AgentFactory(db=None, model=MagicMock(), config_client=mock_config_client)

    # Prevent build_model from needing real API keys
    factory.build_model = MagicMock(return_value=MagicMock())

    captured_tools = []
    def fake_nomi(db, model, tools, **kwargs):
        captured_tools.extend(tools)
        agent = MagicMock()
        agent.name = "nomi"
        return agent

    monkeypatch.setattr("src.agents.factory.NomiAgent", fake_nomi)

    await factory.build(
        session_id="sess1",
        user_id="user1",
        model_name="gemini-2.0-flash",
        client_tool_runner=AsyncMock(),
    )

    assert any(getattr(t, "name", None) == "discovery_tool" for t in captured_tools)


@pytest.mark.asyncio
async def test_factory_uses_legacy_mode_when_flag_not_set(monkeypatch):
    """Without USE_DISCOVERY_TOOL, agent uses the normal tool building path."""
    monkeypatch.delenv("USE_DISCOVERY_TOOL", raising=False)

    from src.agents.factory import AgentFactory
    from src.tools.config import ToolConfigClient

    mock_config_client = MagicMock(spec=ToolConfigClient)
    mock_config_client.fetch_tools = AsyncMock(return_value=MagicMock(entries={}))
    factory = AgentFactory(db=None, model=MagicMock(), config_client=mock_config_client)

    # Prevent build_model from needing real API keys
    factory.build_model = MagicMock(return_value=MagicMock())

    captured_tools = []
    def fake_nomi(db, model, tools, **kwargs):
        captured_tools.extend(tools)
        agent = MagicMock()
        agent.name = "nomi"
        return agent

    monkeypatch.setattr("src.agents.factory.NomiAgent", fake_nomi)
    # Mock build_tools to return empty list (no real toolkit construction)
    monkeypatch.setattr("src.agents.factory.build_tools", AsyncMock(return_value=[]))

    await factory.build(
        session_id="sess1",
        user_id="user1",
        model_name="gemini-2.0-flash",
        client_tool_runner=AsyncMock(),
    )

    # discovery_tool should NOT be in tools in legacy mode
    assert not any(getattr(t, "name", None) == "discovery_tool" for t in captured_tools)
