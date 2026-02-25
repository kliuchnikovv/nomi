# back/tests/tools/test_catalog.py
from src.tools.factory import ToolsConfig
from src.tools.catalog import ToolEntry, ToolCatalog, build_catalog


def test_tool_entry_fields():
    entry = ToolEntry(
        name="github",
        display_name="GitHub",
        description="Manage repos",
        execution_type="server",
        methods=[{"name": "list_repos", "description": "List repos"}],
        params={"access_token": "tok"},
        provider="github",
    )
    assert entry.name == "github"
    assert entry.execution_type == "server"


def test_catalog_to_prompt_text():
    catalog = ToolCatalog(entries={
        "web_search": ToolEntry(
            name="web_search",
            display_name="Web Search",
            description="Search the internet",
            execution_type="server",
            methods=[{"name": "duckduckgo_search", "description": "Search"}],
            params={},
            provider="web_search",
        )
    })
    text = catalog.to_prompt_text()
    assert "web_search" in text
    assert "Search the internet" in text
    assert "duckduckgo_search" in text
    assert "server" in text


def test_build_catalog_includes_web_search():
    config = ToolsConfig()
    config.add("web_search")
    catalog = build_catalog(config)
    assert "web_search" in catalog.entries
    entry = catalog.entries["web_search"]
    assert entry.execution_type == "server"


def test_build_catalog_always_includes_web_search():
    config = ToolsConfig()
    catalog = build_catalog(config)
    assert "web_search" in catalog.entries
