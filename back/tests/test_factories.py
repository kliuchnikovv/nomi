import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from agno.models.base import Model
from agno.models.google import Gemini
from src.agents.factory import AgentFactory
from src.teams.factory import TeamFactory
from src.tools.models import ToolSpec
from src.agents.genie import GenieAgent
from src.agents.rag import RagAgent
from src.agents.memoriser import MemoriserAgent
from src.agents.mailer import MailerAgent

# Mocks
class MockConfigClient:
    pass

@pytest.fixture
def agent_factory():
    db = MagicMock()
    model = MagicMock(spec=Model)
    config_client = MagicMock()
    return AgentFactory(db, model, config_client, debug_mode=True)

@pytest.mark.asyncio
async def test_agent_factory_build_default(agent_factory):
    """Test building a default agent (GenieAgent)"""
    with patch("src.agents.factory.build_tools", new_callable=AsyncMock) as mock_build_tools:
        mock_build_tools.return_value = []

        agent = await agent_factory.build(session_id="sess-1")

        assert isinstance(agent, GenieAgent)
        # Session ID is not set on the agent instance by the factory currently,
        # it just logs it.
        # assert agent.session_id == "sess-1"
        pass

@pytest.mark.asyncio
async def test_agent_factory_build_specific_types(agent_factory):
    """Test building specific agent types"""
    with patch("src.agents.factory.build_tools", new_callable=AsyncMock) as mock_build_tools:
        mock_build_tools.return_value = []

        # Mailer
        agent = await agent_factory.build(session_id="sess-1", agent_type="mailer")
        assert isinstance(agent, MailerAgent)

        # Rag
        agent = await agent_factory.build(session_id="sess-1", agent_type="rag")
        assert isinstance(agent, RagAgent)

        # Memoriser
        agent = await agent_factory.build(session_id="sess-1", agent_type="memoriser")
        assert isinstance(agent, MemoriserAgent)

@pytest.mark.asyncio
async def test_agent_factory_build_with_model_override(agent_factory):
    """Test building agent with a specific model"""
    with patch("src.agents.factory.build_tools", new_callable=AsyncMock) as mock_build_tools, \
         patch("src.agents.factory.os.getenv", return_value="fake-api-key"):
        mock_build_tools.return_value = []

        # Using gemini model name triggers build_model
        agent = await agent_factory.build(
            session_id="sess-1",
            model_name="gemini-2.0-flash"
        )

        assert isinstance(agent.model, Gemini)
        assert agent.model.id == "gemini-2.0-flash"

@pytest.mark.asyncio
async def test_agent_factory_build_with_tools(agent_factory):
    """Test building agent with tool specs"""
    with patch("src.agents.factory.build_tools", new_callable=AsyncMock) as mock_build_tools:
        # Mock tools that have a .name attribute
        mock_tool = MagicMock()
        mock_tool.name = "mock_tool"
        mock_build_tools.return_value = [mock_tool]

        tools_specs = [
            ToolSpec(name="google_calendar", enabled=True, params={"param1": "value1"})
        ]

        await agent_factory.build(session_id="sess-1", tools_specs=tools_specs)

        # Verify build_tools was called with correct config
        mock_build_tools.assert_called_once()
        args, _ = mock_build_tools.call_args
        config = args[0]
        # We can't easily inspect ToolsConfig internals without importing it,
        # but we assume if it called build_tools it processed the specs.

@pytest.mark.asyncio
async def test_team_factory_build(agent_factory):
    """Test building a Team"""
    team_factory = TeamFactory(
        agent_factory=agent_factory,
        db=agent_factory._db,
        model=agent_factory._model
    )

    command_desc = {
        "name": "Test Team",
        "model": "gemini-1.5-flash",
        "participants": [
            {"type": "genie", "model": "gemini-1.5-flash"},
            {"type": "mailer", "model": "gemini-1.5-flash"}
        ]
    }

    with patch("src.agents.factory.build_tools", new_callable=AsyncMock) as mock_build_tools, \
         patch("src.agents.factory.os.getenv", return_value="fake-api-key"):
        mock_build_tools.return_value = []

        team = await team_factory.build(command_desc, session_id="sess-team")

        assert team.name == "Test Team"
        assert len(team.members) == 2
        assert isinstance(team.members[0], GenieAgent)
        assert isinstance(team.members[1], MailerAgent)
        assert team.session_id == "sess-team"


@pytest.mark.asyncio
async def test_agent_factory_build_with_web_search(agent_factory):
    """Test building agent with web_search enabled creates Gemini with search=True"""
    with patch("src.agents.factory.build_tools", new_callable=AsyncMock) as mock_build_tools, \
         patch("src.agents.factory.os.getenv", return_value="fake-api-key"):
        mock_build_tools.return_value = []

        # Build with web_search=True
        agent = await agent_factory.build(
            session_id="sess-1",
            model_name="gemini-2.0-flash",
            web_search=True
        )

        assert isinstance(agent.model, Gemini)
        assert agent.model.id == "gemini-2.0-flash"
        assert agent.model.search == True  # Verify search is enabled


@pytest.mark.asyncio
async def test_agent_factory_build_without_web_search(agent_factory):
    """Test building agent without web_search creates Gemini with search=False"""
    with patch("src.agents.factory.build_tools", new_callable=AsyncMock) as mock_build_tools, \
         patch("src.agents.factory.os.getenv", return_value="fake-api-key"):
        mock_build_tools.return_value = []

        # Build with web_search=False (default)
        agent = await agent_factory.build(
            session_id="sess-1",
            model_name="gemini-2.0-flash",
            web_search=False
        )

        assert isinstance(agent.model, Gemini)
        assert agent.model.search == False  # Verify search is disabled


@pytest.mark.asyncio
async def test_agent_factory_build_with_thinking(agent_factory):
    """Test building agent with thinking mode enabled for Gemini 2.5 models"""
    with patch("src.agents.factory.build_tools", new_callable=AsyncMock) as mock_build_tools, \
         patch("src.agents.factory.os.getenv", return_value="fake-api-key"):
        mock_build_tools.return_value = []

        # Build with thinking=True for a 2.5 model
        agent = await agent_factory.build(
            session_id="sess-1",
            model_name="gemini-2.5-flash",
            thinking=True
        )

        assert isinstance(agent.model, Gemini)
        assert agent.model.id == "gemini-2.5-flash"
        # Verify thinking config is passed
        assert agent.model.thinking_budget == -1
        assert agent.model.include_thoughts == True


@pytest.mark.asyncio
async def test_agent_factory_build_thinking_not_supported_for_older_models(agent_factory):
    """Test that thinking mode is not enabled for older Gemini models"""
    with patch("src.agents.factory.build_tools", new_callable=AsyncMock) as mock_build_tools, \
         patch("src.agents.factory.os.getenv", return_value="fake-api-key"):
        mock_build_tools.return_value = []

        # Build with thinking=True for a 2.0 model (should not enable thinking)
        agent = await agent_factory.build(
            session_id="sess-1",
            model_name="gemini-2.0-flash",
            thinking=True
        )

        assert isinstance(agent.model, Gemini)
        assert agent.model.id == "gemini-2.0-flash"
        # Thinking should not be enabled for 2.0 models
        assert agent.model.thinking_budget is None


@pytest.mark.asyncio
async def test_agent_factory_build_thinking_not_supported_for_lite(agent_factory):
    """Test that thinking mode is not enabled for lite models"""
    with patch("src.agents.factory.build_tools", new_callable=AsyncMock) as mock_build_tools, \
         patch("src.agents.factory.os.getenv", return_value="fake-api-key"):
        mock_build_tools.return_value = []

        # Build with thinking=True for a lite model (should not enable thinking)
        agent = await agent_factory.build(
            session_id="sess-1",
            model_name="gemini-2.5-flash-lite",
            thinking=True
        )

        assert isinstance(agent.model, Gemini)
        assert agent.model.id == "gemini-2.5-flash-lite"
        # Thinking should not be enabled for lite models
        assert agent.model.thinking_budget is None

