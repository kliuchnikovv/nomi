# back/tests/tools/test_discovery.py
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.tools.catalog import ToolCatalog, ToolEntry
from src.tools.discovery import DiscoverySubAgent


def _make_catalog() -> ToolCatalog:
    return ToolCatalog(entries={
        "gmail": ToolEntry(
            name="gmail", display_name="Gmail", description="Send and read emails",
            execution_type="client",
            methods=[{"name": "send_email"}, {"name": "get_recent_emails"}],
            params={}, provider=None,
        ),
        "github": ToolEntry(
            name="github", display_name="GitHub", description="Manage repositories",
            execution_type="server",
            methods=[{"name": "list_repos"}, {"name": "create_issue"}],
            params={}, provider="github",
        ),
        "web_search": ToolEntry(
            name="web_search", display_name="Web Search", description="Search the internet",
            execution_type="server", methods=[{"name": "duckduckgo_search"}],
            params={}, provider="web_search",
        ),
    })


def test_discovery_sub_agent_returns_valid_names():
    """DiscoverySubAgent.find_tools should return names present in catalog."""
    catalog = _make_catalog()
    mock_model = MagicMock()

    with patch("src.tools.discovery.Agent") as MockAgent:
        mock_run_response = MagicMock()
        mock_run_response.content = '["gmail"]'
        mock_agent_instance = MagicMock()
        mock_agent_instance.arun = AsyncMock(return_value=mock_run_response)
        MockAgent.return_value = mock_agent_instance

        sub = DiscoverySubAgent(model=mock_model, catalog=catalog)
        result = asyncio.run(sub.find_tools("send an email"))

    assert result == ["gmail"]


def test_discovery_sub_agent_filters_invalid_names():
    """DiscoverySubAgent should ignore tool names not in catalog."""
    catalog = _make_catalog()
    mock_model = MagicMock()

    with patch("src.tools.discovery.Agent") as MockAgent:
        mock_run_response = MagicMock()
        mock_run_response.content = '["gmail", "nonexistent_tool"]'
        mock_agent_instance = MagicMock()
        mock_agent_instance.arun = AsyncMock(return_value=mock_run_response)
        MockAgent.return_value = mock_agent_instance

        sub = DiscoverySubAgent(model=mock_model, catalog=catalog)
        result = asyncio.run(sub.find_tools("send an email"))

    assert result == ["gmail"]
    assert "nonexistent_tool" not in result


def test_discovery_sub_agent_handles_bad_json():
    """DiscoverySubAgent should return empty list on malformed response."""
    catalog = _make_catalog()
    mock_model = MagicMock()

    with patch("src.tools.discovery.Agent") as MockAgent:
        mock_run_response = MagicMock()
        mock_run_response.content = "I cannot determine which tools to use."
        mock_agent_instance = MagicMock()
        mock_agent_instance.arun = AsyncMock(return_value=mock_run_response)
        MockAgent.return_value = mock_agent_instance

        sub = DiscoverySubAgent(model=mock_model, catalog=catalog)
        result = asyncio.run(sub.find_tools("something unclear"))

    assert result == []


def test_discovery_sub_agent_reraises_cancelled_error():
    """DiscoverySubAgent.find_tools must re-raise asyncio.CancelledError."""
    catalog = _make_catalog()
    mock_model = MagicMock()

    with patch("src.tools.discovery.Agent") as MockAgent:
        mock_agent_instance = MagicMock()
        mock_agent_instance.arun = AsyncMock(side_effect=asyncio.CancelledError())
        MockAgent.return_value = mock_agent_instance

        sub = DiscoverySubAgent(model=mock_model, catalog=catalog)
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(sub.find_tools("any query"))


# ---------------------------------------------------------------------------
# Task 3 tests – DiscoveryToolkit and _build_toolkit_for
# ---------------------------------------------------------------------------
from src.tools.discovery import DiscoveryToolkit, _build_toolkit_for


def test_build_toolkit_for_web_search_returns_toolkit():
    """_build_toolkit_for should return a list with one Toolkit for web_search."""
    catalog = _make_catalog()
    catalog.entries["web_search"] = ToolEntry(
        name="web_search", display_name="Web Search", description="Search",
        execution_type="server",
        methods=[{"name": "duckduckgo_search"}],
        params={}, provider="web_search",
    )
    from src.tools.factory import ToolsConfig
    config = ToolsConfig()
    config.add("web_search")

    result = asyncio.run(_build_toolkit_for("web_search", catalog, config, None))
    assert len(result) >= 1


def test_discovery_toolkit_sets_discovery_done():
    """discover_tools() should set agent._discovery_done = True."""
    catalog = _make_catalog()
    catalog.entries["web_search"] = ToolEntry(
        name="web_search", display_name="Web Search", description="Search",
        execution_type="server",
        methods=[{"name": "duckduckgo_search"}],
        params={}, provider="web_search",
    )
    from src.tools.factory import ToolsConfig
    config = ToolsConfig()
    config.add("web_search")

    mock_model = MagicMock()
    mock_agent = MagicMock()
    mock_agent._discovery_done = False

    with patch("src.tools.discovery.Agent") as MockAgent:
        mock_run_response = MagicMock()
        mock_run_response.content = '["web_search"]'
        mock_agent_instance = MagicMock()
        mock_agent_instance.arun = AsyncMock(return_value=mock_run_response)
        MockAgent.return_value = mock_agent_instance

        toolkit = DiscoveryToolkit(
            catalog=catalog,
            config=config,
            sub_agent_model=mock_model,
            client_tool_runner=None,
        )
        toolkit.set_parent_agent(mock_agent)

        result = asyncio.run(toolkit.discover_tools("search the web"))

    assert mock_agent._discovery_done is True
    assert "web_search" in result.lower()
