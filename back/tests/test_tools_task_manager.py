import pytest
import requests
import os
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

@pytest.fixture
def mock_engine():
    with patch("src.tools.task_manager.create_engine") as mock:
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

# --- API Fallback Tests (when user_id is None) ---

def test_list_projects_api_success(mock_get):
    # Setup mock response
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = SAMPLE_PROJECTS
    mock_get.return_value = mock_response

    # Initialize WITHOUT user_id
    tool = TaskManagementTool(api_url="http://test-api")
    
    # Execute
    result = tool.list_projects()

    # Verify
    assert "Project One" in result
    assert "Project Two" in result
    assert "p1" in result
    
    # Verify URL was called correctly
    mock_get.assert_called_once()
    args, kwargs = mock_get.call_args
    assert args[0] == "http://test-api/api/projects"

def test_list_projects_api_error(mock_get):
    # Setup error mock
    mock_get.side_effect = requests.exceptions.RequestException("404 Not Found")

    tool = TaskManagementTool(api_url="http://test-api")
    
    # Execute
    result = tool.list_projects()

    # Verify
    assert "Error listing projects" in result
    assert "404 Not Found" in result

# --- DB Access Tests (when user_id is set) ---

def test_list_projects_db_success(mock_engine):
    # Setup Mock DB Context
    mock_conn = MagicMock()
    mock_engine.return_value.connect.return_value.__enter__.return_value = mock_conn
    
    # Mock Result Rows (id, name, description)
    mock_conn.execute.return_value = [
        ("db-p1", "DB Project Alpha", "Desc Alpha"),
        ("db-p2", "DB Project Beta", None)
    ]

    with patch.dict(os.environ, {"DB_DSN": "postgresql://user:pass@localhost:5432/db"}):
        # Initialize WITH user_id
        tool = TaskManagementTool(api_url="http://test-api", user_id="user-123")
        
        # Execute
        result = tool.list_projects()

    # Verify
    assert "DB Project Alpha" in result
    assert "db-p1" in result
    assert "DB Project Beta" in result
    assert "Desc Alpha" in result
    
    # Verify DB was queried
    mock_engine.assert_called_once_with("postgresql://user:pass@localhost:5432/db")
    mock_conn.execute.assert_called_once()
    assert "user-123" in str(mock_conn.execute.call_args) # Check binding roughly

def test_list_projects_db_empty(mock_engine):
    # Setup Mock DB Context with empty result
    mock_conn = MagicMock()
    mock_engine.return_value.connect.return_value.__enter__.return_value = mock_conn
    mock_conn.execute.return_value = []

    with patch.dict(os.environ, {"DB_DSN": "postgresql://user:pass@localhost:5432/db"}):
        tool = TaskManagementTool(user_id="user-123")
        result = tool.list_projects()

    assert "No projects found" in result

def test_list_projects_db_failure(mock_engine):
    # Setup Mock DB Failure
    mock_engine.return_value.connect.side_effect = Exception("DB Connection Failed")

    with patch.dict(os.environ, {"DB_DSN": "postgresql://user:pass@localhost:5432/db"}):
        tool = TaskManagementTool(user_id="user-123")
        result = tool.list_projects()

    assert "Error listing projects from DB" in result
    assert "DB Connection Failed" in result
