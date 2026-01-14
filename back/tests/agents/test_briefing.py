import pytest
from unittest.mock import MagicMock
from back.agents.briefing import BriefingAgent, BriefingInput

@pytest.fixture
def briefing_agent():
    # Create a mock for the tools used by the BriefingAgent
    mock_tools = {
        "get_project_context": MagicMock(),
        "search_knowledge": MagicMock()
    }
    return BriefingAgent(tools=mock_tools)

def test_briefing_agent_run_success(briefing_agent):
    # Arrange: Set up the mock return values
    project_name = "Test Project"
    project_context_return = {
        "name": project_name,
        "description": "This is a test project.",
        "repository": "test/repo",
        "tasks": [{"id": "1", "title": "First task"}, {"id": "2", "title": "Second task"}],
        "members": ["user1", "user2"]
    }
    knowledge_search_return = [
        "Knowledge snippet 1",
        "Knowledge snippet 2"
    ]

    briefing_agent.tools.get_project_context.return_value = project_context_return
    briefing_agent.tools.search_knowledge.return_value = knowledge_search_return

    # Act: Run the agent
    input_data = BriefingInput(project_name=project_name)
    result = briefing_agent.run(input_data)

    # Assert: Check that the output is as expected
    briefing_agent.tools.get_project_context.assert_called_once_with(project_name=project_name)
    briefing_agent.tools.search_knowledge.assert_called_once_with(query=f"project_name: {project_name}")

    assert f"Briefing for project: {project_name}" in result
    assert "Description: This is a test project." in result
    assert "Repository: test/repo" in result
    assert "### Relevant Knowledge" in result
    assert "- Knowledge snippet 1" in result
    assert "- Knowledge snippet 2" in result
    assert "### Current Tasks" in result
    assert "- (ID: 1) First task" in result
    assert "- (ID: 2) Second task" in result
    assert "### Team Members" in result
    assert "- user1" in result
    assert "- user2" in result

def test_briefing_agent_project_not_found(briefing_agent):
    # Arrange: Mock get_project_context to return None
    project_name = "Non-existent Project"
    briefing_agent.tools.get_project_context.return_value = None

    # Act: Run the agent
    input_data = BriefingInput(project_name=project_name)
    result = briefing_agent.run(input_data)

    # Assert: Check for the correct message
    briefing_agent.tools.get_project_context.assert_called_once_with(project_name=project_name)
    briefing_agent.tools.search_knowledge.assert_not_called()
    assert f"Project '{project_name}' not found." in result

def test_briefing_agent_no_knowledge_found(briefing_agent):
    # Arrange: Mock search_knowledge to return an empty list
    project_name = "Test Project"
    project_context_return = {
        "name": project_name,
        "description": "This is a test project.",
        "repository": "test/repo",
        "tasks": [],
        "members": []
    }
    briefing_agent.tools.get_project_context.return_value = project_context_return
    briefing_agent.tools.search_knowledge.return_value = []

    # Act: Run the agent
    input_data = BriefingInput(project_name=project_name)
    result = briefing_agent.run(input_data)

    # Assert: Check that the knowledge section indicates nothing was found
    assert "### Relevant Knowledge" in result
    assert "No specific knowledge found for this project." in result