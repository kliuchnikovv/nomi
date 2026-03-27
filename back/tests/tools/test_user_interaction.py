import pytest
from unittest.mock import AsyncMock


class TestUserInteractionTools:
    def test_initialization(self):
        from src.tools.user_interaction import UserInteractionTools

        tools = UserInteractionTools()
        assert tools.name == "user_interaction"
        assert tools.client_tool_runner is None

    def test_has_ask_user_method(self):
        from src.tools.user_interaction import UserInteractionTools

        tools = UserInteractionTools()
        assert hasattr(tools, "ask_user")

    @pytest.mark.asyncio
    async def test_ask_user_without_client_runner_returns_error(self):
        from src.tools.user_interaction import UserInteractionTools

        tools = UserInteractionTools()
        result = await tools.ask_user("Test question?", ["Option 1", "Option 2"])

        assert "Error" in result
        assert "client_tool_runner not available" in result

    @pytest.mark.asyncio
    async def test_ask_user_with_client_runner(self):
        from src.tools.user_interaction import UserInteractionTools

        tools = UserInteractionTools()
        mock_runner = AsyncMock(return_value="selected_option")
        tools.client_tool_runner = mock_runner

        result = await tools.ask_user("Test question?", ["Option 1", "Option 2"])

        mock_runner.assert_called_once()
        call_args = mock_runner.call_args
        assert call_args[0][0] == "ask_user"
        assert call_args[0][1] == "ask"
        assert call_args[0][2]["question"] == "Test question?"
        assert call_args[0][2]["options"] == ["Option 1", "Option 2"]
        assert call_args[0][2]["allow_custom"] is True
        assert result == "selected_option"

    @pytest.mark.asyncio
    async def test_ask_user_exception_returns_error(self):
        from src.tools.user_interaction import UserInteractionTools

        tools = UserInteractionTools()
        mock_runner = AsyncMock(side_effect=Exception("Network error"))
        tools.client_tool_runner = mock_runner

        result = await tools.ask_user("Test question?", ["Option 1"])

        assert "Error" in result
        assert "Network error" in result

    @pytest.mark.asyncio
    async def test_ask_user_allow_custom_always_true(self):
        from src.tools.user_interaction import UserInteractionTools

        tools = UserInteractionTools()
        mock_runner = AsyncMock(return_value="custom answer")
        tools.client_tool_runner = mock_runner

        await tools.ask_user("Question?", ["A", "B"])

        call_args = mock_runner.call_args[0][2]
        assert call_args["allow_custom"] is True
