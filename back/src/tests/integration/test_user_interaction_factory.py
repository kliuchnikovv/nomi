"""
Integration test to verify UserInteractionTools is properly integrated into agents.
This test verifies that when an agent is built with client_tool_runner,
the ask_user tool is available and client_tool_runner is injected.
"""

import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from agno.agent import Agent
from agno.models.base import Model
from src.agents.factory import AgentFactory
from src.tools.user_interaction import UserInteractionTools

# Set mock environment variables for tests
os.environ["GOOGLE_API_KEY"] = "test-api-key"


@pytest.mark.asyncio
async def test_user_interaction_in_factory():
    """Test that UserInteractionTools is created by factory with client_tool_runner."""
    # Mock dependencies
    mock_db = MagicMock()
    mock_config_client = MagicMock()
    mock_config_client.fetch_tools = AsyncMock(return_value=MagicMock(entries={}))

    # Mock model - use a supported model name
    mock_model = MagicMock(spec=Model)

    # Create factory
    factory = AgentFactory(
        db=mock_db,
        model=mock_model,
        config_client=mock_config_client,
        debug_mode=False,
    )

    # Mock client_tool_runner
    mock_runner = AsyncMock(return_value="User response")

    # Build agent with client_tool_runner - use supported model
    wrapped_agent = await factory.build(
        session_id="test-session",
        tools_specs=[],
        model_name="gemini-2.0-flash",
        agent_type="genie",
        command_desc={},
        web_search=False,
        thinking="off",
        user_id="test-user",
        chat_id="test-chat",
        endpoint=None,
        client_tool_runner=mock_runner,
    )

    # Verify wrapped agent is created
    assert wrapped_agent is not None
    assert hasattr(wrapped_agent, "_agent")

    # Get the actual agent from wrapper
    agent = wrapped_agent._agent

    # Verify that ask_user tool is available
    assert hasattr(agent, "tools")
    if hasattr(agent, "tools"):
        tools = agent.tools if agent.tools else []
        # Find UserInteractionTools
        user_interaction_tool = None
        for tool in tools:
            if isinstance(tool, UserInteractionTools):
                user_interaction_tool = tool
                break

        # Verify UserInteractionTools exists
        assert user_interaction_tool is not None, (
            "UserInteractionTools not found in agent tools"
        )

        # Verify client_tool_runner is injected
        assert user_interaction_tool.client_tool_runner == mock_runner, (
            "client_tool_runner not injected"
        )

        # Verify ask_user method exists
        assert hasattr(user_interaction_tool, "ask_user")
        assert callable(user_interaction_tool.ask_user)

    print("✅ UserInteractionTools properly integrated in factory!")
