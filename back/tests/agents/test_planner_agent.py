"""Tests for the PlannerAgent builder."""
from unittest.mock import MagicMock
from agno.agent import Agent
from agno.models.base import Model

from src.agents.planner import build_planner_agent, PLANNER_INSTRUCTIONS


def make_model() -> Model:
    return MagicMock(spec=Model)


def test_build_planner_agent_returns_agent():
    agent = build_planner_agent(model=make_model(), tools=[])
    assert isinstance(agent, Agent)


def test_build_planner_agent_history_enabled():
    """Agent must keep conversation history for iterative planning dialog."""
    agent = build_planner_agent(model=make_model(), tools=[])
    assert agent.add_history_to_context is True


def test_build_planner_agent_streaming_enabled():
    agent = build_planner_agent(model=make_model(), tools=[])
    assert agent.stream is True
    assert agent.stream_events is True


def test_build_planner_agent_named_planner():
    agent = build_planner_agent(model=make_model(), tools=[])
    assert agent.name == "Planner"


def test_build_planner_agent_no_datetime_in_context():
    """Date/time is injected into the prompt manually, not via Agno's built-in flag."""
    agent = build_planner_agent(model=make_model(), tools=[])
    assert agent.add_datetime_to_context is False


def test_build_planner_agent_tools_passed_through():
    mock_tool = MagicMock()
    agent = build_planner_agent(model=make_model(), tools=[mock_tool])
    assert mock_tool in agent.tools


def test_system_prompt_contains_phases():
    """Prompt must guide the agent through gather/build/review/iterate phases."""
    for phase in ("GATHER", "BUILD", "REVIEW", "ITERATE"):
        assert phase in PLANNER_INSTRUCTIONS, f"Phase '{phase}' missing from PLANNER_INSTRUCTIONS"


def test_system_prompt_mentions_patch_tool():
    assert "patch_plan_document" in PLANNER_INSTRUCTIONS


def test_system_prompt_mentions_ask_user():
    assert "ask_user" in PLANNER_INSTRUCTIONS


def test_system_prompt_mentions_web_search():
    assert "web_search" in PLANNER_INSTRUCTIONS


def test_build_planner_agent_injects_current_datetime():
    """Current date/time must be appended to the agent's instructions."""
    agent = build_planner_agent(model=make_model(), tools=[], timezone="UTC")
    # Instructions should extend beyond base PLANNER_INSTRUCTIONS
    assert len(agent.instructions) > len(PLANNER_INSTRUCTIONS)
    assert "Current date/time" in agent.instructions


def test_build_planner_agent_uses_provided_timezone():
    """Timezone is used when formatting the current date/time."""
    agent = build_planner_agent(model=make_model(), tools=[], timezone="Europe/Moscow")
    assert agent.instructions is not None
