import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock


FAKE_MODELS_JSON = {
    "models": [
        {
            "id": "gemini-2.0-flash",
            "provider": "google",
            "supports_vision": False,
            "endpoint": "https://generativelanguage.googleapis.com",
        },
        {
            "id": "claude-sonnet-4-6",
            "provider": "anthropic",
            "supports_vision": False,
            "endpoint": "https://api.anthropic.com",
        },
        {
            "id": "meta-llama/llama-3.3-70b-instruct:free",
            "provider": "openrouter",
            "supports_vision": False,
            "endpoint": "https://openrouter.ai/api/v1",
        },
        {
            "id": "glm-4.7",
            "provider": "z.ai",
            "supports_vision": False,
            "endpoint": "https://api.z.ai/v1",
        },
    ]
}


def _write_fake_config(tmp_path: Path) -> Path:
    p = tmp_path / "models.json"
    p.write_text(json.dumps(FAKE_MODELS_JSON))
    return p


def test_load_provider_google(tmp_path):
    cfg = _write_fake_config(tmp_path)
    from providers import load_provider, GoogleProvider
    with patch("providers.CONFIG_PATH", cfg):
        p = load_provider("google", "gemini-2.0-flash")
    assert isinstance(p, GoogleProvider)
    assert p.model == "gemini-2.0-flash"


def test_load_provider_anthropic(tmp_path):
    cfg = _write_fake_config(tmp_path)
    from providers import load_provider, AnthropicProvider
    with patch("providers.CONFIG_PATH", cfg):
        p = load_provider("anthropic", "claude-sonnet-4-6")
    assert isinstance(p, AnthropicProvider)


def test_load_provider_openai_compatible(tmp_path):
    cfg = _write_fake_config(tmp_path)
    from providers import load_provider, OpenAICompatibleProvider
    with patch("providers.CONFIG_PATH", cfg):
        p = load_provider("openrouter", "meta-llama/llama-3.3-70b-instruct:free")
    assert isinstance(p, OpenAICompatibleProvider)
    assert "openrouter.ai" in p.base_url


def test_load_provider_unknown_raises(tmp_path):
    cfg = _write_fake_config(tmp_path)
    from providers import load_provider
    with patch("providers.CONFIG_PATH", cfg):
        with pytest.raises(ValueError, match="Unknown provider"):
            load_provider("unknown-provider", "some-model")


def test_load_provider_model_not_in_config_raises(tmp_path):
    cfg = _write_fake_config(tmp_path)
    from providers import load_provider
    with patch("providers.CONFIG_PATH", cfg):
        with pytest.raises(ValueError, match="not found"):
            load_provider("google", "nonexistent-model")


def test_anthropic_vision_supported():
    from providers import AnthropicProvider
    with patch("anthropic.Anthropic"):
        p = AnthropicProvider("claude-sonnet-4-6")
    assert p.supports_vision is True


def test_google_vision_supported():
    from providers import GoogleProvider
    with patch("google.genai.Client"):
        p = GoogleProvider("gemini-2.0-flash")
    assert p.supports_vision is True


def test_openai_compatible_no_vision():
    from providers import OpenAICompatibleProvider
    with patch("openai.OpenAI"):
        p = OpenAICompatibleProvider(
            model="llama-3.3-70b",
            base_url="https://openrouter.ai/api/v1",
            api_key="test",
        )
    assert p.supports_vision is False
