from unittest.mock import MagicMock
from agno.models.base import Model
from src.teams.development.agents import ArchitectAgent
from src.tools.task_manager import TaskManagementTool


def test_architect_agent_init():
    # 1. Initialize real TaskManagementTool (safe to init, connects lazily)
    task_tool = TaskManagementTool(api_url="http://mock", user_id="u1", auth_token="t1")

    # 2. Mock Model
    mock_model = MagicMock(spec=Model)

    # 3. Initialize Agent
    architect = ArchitectAgent(model=mock_model, tools=[task_tool])

    # 4. Verify tools are registered
    # architect.tools should contain Tool objects
    tool_names = [t.name for t in architect.tools]

    # Agno 2.4.0 seems to store Toolkits in tools list
    assert "task_management_tool" in tool_names
    # assert "update_task_status" in tool_names # This might be inside the toolkit
