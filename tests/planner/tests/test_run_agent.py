import json
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest


def test_list_paths_prints_all(tmp_path, capsys):
    (tmp_path / "01_foo.yaml").write_text("id: 1\nname: Foo\n")
    (tmp_path / "02_bar.yaml").write_text("id: 2\nname: Bar\n")
    from run_agent import list_paths
    list_paths(tmp_path)
    out = capsys.readouterr().out
    assert "Foo" in out
    assert "Bar" in out


def test_load_path_found(tmp_path):
    (tmp_path / "02_full_route.yaml").write_text("id: 2\nname: Full route\n")
    from run_agent import load_path
    descriptor = load_path(2, tmp_path)
    assert descriptor["id"] == 2


def test_load_path_not_found_exits(tmp_path):
    from run_agent import load_path
    with pytest.raises(SystemExit):
        load_path(99, tmp_path)


def test_load_default_provider_returns_first_with_tools(tmp_path):
    config = {
        "models": [
            {"id": "no-tools", "provider": "openai", "supports_tools": False},
            {"id": "with-tools", "provider": "google", "supports_tools": True},
        ]
    }
    cfg_path = tmp_path / "models.json"
    cfg_path.write_text(json.dumps(config))
    from run_agent import load_default_provider
    import run_agent
    original = run_agent.CONFIG_PATH
    run_agent.CONFIG_PATH = cfg_path
    try:
        provider, model = load_default_provider()
        assert provider == "google"
        assert model == "with-tools"
    finally:
        run_agent.CONFIG_PATH = original
