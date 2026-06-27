"""Tests for the lightweight group/inline agent and its factory dispatch.

The group agent must be built with ONLY web-search tools — no personal-data tools
(integrations, client tools, knowledge, memory, delegation) — for public chats.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock


class _NamedTool:
    def __init__(self, name):
        self.name = name


# ── build_group_agent unit ────────────────────────────────────────────


def test_build_group_agent_passes_tools_and_instructions():
    from src.agents.group import build_group_agent

    web = _NamedTool("web_search")
    agent = build_group_agent(model=MagicMock(), tools=[web], timezone="UTC")

    assert agent.name == "GroupChat"
    assert list(agent.tools) == [web]
    # Instructions must steer away from personal data and toward proactive search.
    assert "web_search" in agent.instructions
    assert "personal" in agent.instructions.lower()


# ── factory dispatch ───────────────────────────────────────────────────


async def _build_group_and_capture(monkeypatch, web_search_tools):
    """Run AgentFactory.build(agent_type='group'); capture tools the group agent got."""
    monkeypatch.delenv("USE_DISCOVERY_TOOL", raising=False)

    from src.agents.factory import AgentFactory
    from src.tools.config import ToolConfigClient

    mock_config_client = MagicMock(spec=ToolConfigClient)
    mock_config_client.fetch_tools = AsyncMock(return_value=MagicMock(entries={}))
    factory = AgentFactory(db=None, model=MagicMock(), config_client=mock_config_client)
    factory.build_model = MagicMock(return_value=MagicMock())

    captured = {}

    def fake_group(model, tools, **kwargs):
        captured["tools"] = list(tools)
        agent = MagicMock()
        agent.name = "GroupChat"
        return agent

    # If the personal NomiAgent path were taken, this would fire and fail the test.
    def fail_nomi(*args, **kwargs):
        raise AssertionError("group agent_type must not build NomiAgent")

    monkeypatch.setattr("src.agents.factory.build_group_agent", fake_group)
    monkeypatch.setattr("src.agents.factory.NomiAgent", fail_nomi)
    monkeypatch.setattr(
        "src.agents.factory.build_tools",
        AsyncMock(return_value=list(web_search_tools)),
    )

    agent = await factory.build(
        session_id="sess1",
        user_id="user1",
        model_name="gemini-2.0-flash",
        agent_type="group",
        client_tool_runner=AsyncMock(),
    )
    return agent, captured


@pytest.mark.asyncio
async def test_group_agent_type_builds_group_with_web_search_only(monkeypatch):
    web = _NamedTool("web_search")
    agent, captured = await _build_group_and_capture(monkeypatch, [web])

    assert agent.name == "GroupChat"
    names = {getattr(t, "name", "") for t in captured["tools"]}
    assert names == {"web_search"}


@pytest.mark.asyncio
async def test_group_agent_skips_web_search_for_gemma(monkeypatch):
    from src.agents.factory import AgentFactory
    from src.tools.config import ToolConfigClient

    monkeypatch.delenv("USE_DISCOVERY_TOOL", raising=False)
    mock_config_client = MagicMock(spec=ToolConfigClient)
    mock_config_client.fetch_tools = AsyncMock(return_value=MagicMock(entries={}))
    factory = AgentFactory(db=None, model=MagicMock(), config_client=mock_config_client)
    factory.build_model = MagicMock(return_value=MagicMock())

    captured = {}

    def fake_group(model, tools, **kwargs):
        captured["tools"] = list(tools)
        agent = MagicMock()
        agent.name = "GroupChat"
        return agent

    build_tools_mock = AsyncMock(return_value=[_NamedTool("web_search")])
    monkeypatch.setattr("src.agents.factory.build_group_agent", fake_group)
    monkeypatch.setattr("src.agents.factory.build_tools", build_tools_mock)

    # Gemma models do not support tools — web search must be skipped.
    await factory.build(
        session_id="sess1",
        user_id="user1",
        model_name="gemma-3-27b",
        agent_type="group",
        client_tool_runner=AsyncMock(),
    )

    assert captured["tools"] == []
    build_tools_mock.assert_not_called()
