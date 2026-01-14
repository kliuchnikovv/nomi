import pytest
import requests
from unittest.mock import patch, MagicMock
from src.tools.task_manager import TaskManagementTool

# Sample project data
SAMPLE_PROJECTS = [
    {"id": "p1", "name": "Project One", "description": "First project"},
    {"id": "p2", "name": "Project Two", "description": "Second project"}
]

@pytest.fixture
def mock_get():
    with patch("src.tools.task_manager.requests.get") as mock:
        yield mock

def test_init_normalizes_url():
    # Test valid URL normalization
    tool = TaskManagementTool(api_url="http://example.com")
    assert tool.api_url == "http://example.com/api"

    # Test already normalized
    tool = TaskManagementTool(api_url="http://example.com/api")
    assert tool.api_url == "http://example.com/api"
    
    # Test with trailing slash
    tool = TaskManagementTool(api_url="http://example.com/")
    assert tool.api_url == "http://example.com/api"

def test_list_projects_success(mock_get):
    # Setup mock response
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = SAMPLE_PROJECTS
    mock_get.return_value = mock_response

    tool = TaskManagementTool(api_url="http://test-api")
    
    # Execute
    result = tool.list_projects()

    # Verify
    assert "Project One" in result
    assert "Project Two" in result
    assert "p1" in result
    
    # Verify URL was called correctly (url in init is http://test-api -> http://test-api/api)
    mock_get.assert_called_once()
    args, kwargs = mock_get.call_args
    assert args[0] == "http://test-api/api/projects"

def test_list_projects_error(mock_get):
    # Setup error mock
    mock_get.side_effect = requests.exceptions.RequestException("404 Not Found")

    tool = TaskManagementTool(api_url="http://test-api")
    
    # Execute
    result = tool.list_projects()

    # Verify
    assert "Error listing projects" in result
    assert "404 Not Found" in result

def test_list_projects_empty(mock_get):
    # Setup empty response
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = []
    mock_get.return_value = mock_response

    tool = TaskManagementTool(api_url="http://test-api")
    
    # Execute
    result = tool.list_projects()

    # Verify
    assert "No projects found" in result
