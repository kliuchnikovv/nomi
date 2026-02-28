# back/tests/tools/test_registry.py
import pytest
from src.tools.registry import ToolRegistry
from src.tools.factory import ToolsConfig


def _make_config(*providers: str) -> ToolsConfig:
    config = ToolsConfig()
    for p in providers:
        config.add(p, access_token="tok", accounts=[{"id": "a@b.com", "display_name": "a@b.com"}])
    return config


def test_registry_returns_schemas_for_connected_integrations(monkeypatch):
    monkeypatch.setattr(
        "src.tools.registry._load_manifest",
        lambda name: {
            "name": name,
            "display_name": name.title(),
            "description": f"{name} integration",
            "methods": [
                {"name": "send", "description": "Send something", "parameters": {"type": "object", "properties": {}}}
            ],
        } if name == "gmail" else None,
    )
    config = _make_config("gmail")
    schemas = ToolRegistry.build(config)
    assert len(schemas) == 1
    assert schemas[0]["name"] == "gmail"
    assert schemas[0]["accounts"] == [{"id": "a@b.com", "display_name": "a@b.com"}]
    assert len(schemas[0]["methods"]) == 1


def test_registry_skips_unknown_integrations(monkeypatch):
    monkeypatch.setattr("src.tools.registry._load_manifest", lambda name: None)
    config = _make_config("unknown_tool")
    schemas = ToolRegistry.build(config)
    assert schemas == []


def test_registry_includes_web_search_without_accounts(monkeypatch):
    monkeypatch.setattr(
        "src.tools.registry._load_manifest",
        lambda name: {
            "name": "web_search",
            "display_name": "Web Search",
            "description": "Search the web",
            "methods": [{"name": "search", "description": "Search", "parameters": {}}],
        } if name == "web_search" else None,
    )
    config = _make_config("web_search")
    # web_search has no accounts field in params
    config.entries["web_search"].params.pop("accounts", None)
    schemas = ToolRegistry.build(config)
    assert len(schemas) == 1
    assert schemas[0]["accounts"] == []
