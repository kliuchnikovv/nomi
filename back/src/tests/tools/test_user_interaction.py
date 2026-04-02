import pytest
from unittest.mock import AsyncMock
from src.tools.user_interaction import UserInteractionTools


@pytest.mark.asyncio
async def test_ask_user_success():
    """Test successful ask_user call with client_tool_runner."""
    mock_runner = AsyncMock(return_value="User selected: bug")
    tool = UserInteractionTools()
    tool.client_tool_runner = mock_runner

    result = await tool.ask_user(
        question="What type of task is this?", options=["bug", "feature", "improvement"]
    )

    assert result == "User selected: bug"
    mock_runner.assert_called_once_with(
        "ask_user",
        "ask",
        {
            "question": "What type of task is this?",
            "options": ["bug", "feature", "improvement"],
            "allow_custom": True,
        },
    )


@pytest.mark.asyncio
async def test_ask_user_no_client_tool_runner():
    """Test ask_user without client_tool_runner."""
    tool = UserInteractionTools()
    tool.client_tool_runner = None

    result = await tool.ask_user(
        question="What is your name?", options=["Alice", "Bob"]
    )

    assert "Error" in result
    assert "client_tool_runner not available" in result


@pytest.mark.asyncio
async def test_ask_user_runner_error():
    """Test ask_user when client_tool_runner raises an exception."""
    mock_runner = AsyncMock(side_effect=Exception("Network error"))
    tool = UserInteractionTools()
    tool.client_tool_runner = mock_runner

    result = await tool.ask_user(
        question="Select color", options=["Red", "Blue", "Green"]
    )

    assert "Error" in result
    assert "Failed to get user response" in result


def test_toolkit_registration():
    """Test that ask_user is registered in toolkit."""
    tool = UserInteractionTools()

    # Check that the method exists on the toolkit
    assert hasattr(tool, "ask_user")
    assert callable(tool.ask_user)


def test_toolkit_name():
    """Test that toolkit has correct name."""
    tool = UserInteractionTools()

    assert tool.name == "user_interaction"
