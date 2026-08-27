"""Tests for the model detection utilities in ``src/models/model_detector.py``.

The real ``src.models`` package imports ``agno`` (not installed here), so the
module under test is loaded directly from its file with ``importlib``, bypassing
the package ``__init__.py``.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Load the module under test directly from its file (avoids importing agno via
# the ``src.models`` package ``__init__.py``).
# ---------------------------------------------------------------------------

_MODULE_PATH = (
    Path(__file__).resolve().parents[2] / "src" / "models" / "model_detector.py"
)
_spec = importlib.util.spec_from_file_location("model_detector", _MODULE_PATH)
assert _spec is not None and _spec.loader is not None
module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(module)

# Symbols under test ---------------------------------------------------------
ModelInfo = module.ModelInfo
ModelDetectionError = module.ModelDetectionError
AuthenticationError = module.AuthenticationError
EndpointNotSupportedError = module.EndpointNotSupportedError
ModelDetectionTimeoutError = module.ModelDetectionTimeoutError
KNOWN_PROVIDERS = module.KNOWN_PROVIDERS
STATIC_MODELS = module.STATIC_MODELS
detect_available_models = module.detect_available_models
detect_models = module.detect_models


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_response(status_code: int = 200, json_payload=None):
    """Build a MagicMock response.

    When ``json_payload`` is ``None`` the ``.json()`` call raises ``ValueError``
    so we can simulate a non-JSON body.
    """
    resp = MagicMock()
    resp.status_code = status_code
    if json_payload is None:
        resp.json.side_effect = ValueError("not valid JSON")
    else:
        resp.json.return_value = json_payload
    resp.raise_for_status.return_value = None
    return resp


# ---------------------------------------------------------------------------
# ModelInfo data model
# ---------------------------------------------------------------------------


class TestModelInfo:
    def test_id_only_is_valid(self):
        m = ModelInfo(id="gpt-4o")
        assert m.id == "gpt-4o"
        assert m.created is None
        assert m.owned_by is None

    def test_all_fields_set(self):
        m = ModelInfo(id="gpt-4o", created=1234567890, owned_by="openai")
        assert m.id == "gpt-4o"
        assert m.created == 1234567890
        assert m.owned_by == "openai"

    def test_missing_id_raises(self):
        with pytest.raises(Exception):
            ModelInfo()  # type: ignore[call-arg]


# ---------------------------------------------------------------------------
# detect_available_models — happy path & parsing
# ---------------------------------------------------------------------------


class TestDetectAvailableModelsSuccess:
    @patch("httpx.get")
    def test_parses_valid_models_response(self, mock_get):
        mock_get.return_value = _make_response(
            200,
            {
                "data": [
                    {
                        "id": "gpt-4o",
                        "created": 1234567890,
                        "owned_by": "openai",
                    },
                    {
                        "id": "gpt-3.5-turbo",
                        "created": 1234567891,
                        "owned_by": "openai",
                    },
                ]
            },
        )

        result = detect_available_models(
            base_url="https://api.openai.com/v1",
            api_key="sk-test",
        )

        assert len(result) == 2
        # Models are sorted alphabetically by id.
        assert [m.id for m in result] == ["gpt-3.5-turbo", "gpt-4o"]
        # Optional fields are parsed correctly.
        turbo = next(m for m in result if m.id == "gpt-3.5-turbo")
        assert turbo.created == 1234567891
        assert turbo.owned_by == "openai"

    @patch("httpx.get")
    def test_builds_correct_url_and_headers(self, mock_get):
        mock_get.return_value = _make_response(200, {"data": [{"id": "a"}]})

        detect_available_models(
            base_url="https://api.openai.com/v1/",
            api_key="sk-test",
        )

        mock_get.assert_called_once()
        call = mock_get.call_args
        url = call.args[0] if call.args else call.kwargs["url"]
        # Trailing slash is stripped before appending /models.
        assert url == "https://api.openai.com/v1/models"
        headers = call.kwargs["headers"]
        assert headers == {"Authorization": "Bearer sk-test"}

    @patch("httpx.get")
    def test_strips_trailing_slash_from_base_url(self, mock_get):
        mock_get.return_value = _make_response(200, {"data": [{"id": "a"}]})

        detect_available_models(base_url="https://x.example/v1//", api_key="k")

        url = mock_get.call_args.args[0]
        assert url == "https://x.example/v1/models"

    @patch("httpx.get")
    def test_uses_timeout(self, mock_get):
        mock_get.return_value = _make_response(200, {"data": [{"id": "a"}]})

        detect_available_models(base_url="https://api.openai.com/v1", api_key="k")

        assert mock_get.call_args.kwargs["timeout"] == 10.0

    @patch("httpx.get")
    def test_missing_optional_fields_default_to_none(self, mock_get):
        mock_get.return_value = _make_response(
            200,
            {"data": [{"id": "bare-model"}]},
        )

        result = detect_available_models(base_url="https://api/v1", api_key="k")

        assert len(result) == 1
        assert result[0].id == "bare-model"
        assert result[0].created is None
        assert result[0].owned_by is None

    @patch("httpx.get")
    def test_skips_malformed_entries(self, mock_get):
        mock_get.return_value = _make_response(
            200,
            {
                "data": [
                    "not-a-dict",
                    {"no_id": "here"},
                    {"id": "valid"},
                ]
            },
        )

        result = detect_available_models(base_url="https://api/v1", api_key="k")

        assert len(result) == 1
        assert result[0].id == "valid"

    @patch("httpx.get")
    def test_custom_endpoint_works(self, mock_get):
        """A non-standard base URL still works end-to-end."""
        mock_get.return_value = _make_response(
            200,
            {"data": [{"id": "custom-model", "owned_by": "me"}]},
        )

        result = detect_available_models(
            base_url="https://custom.api.com/v1",
            api_key="key",
        )

        assert len(result) == 1
        assert result[0].id == "custom-model"
        assert result[0].owned_by == "me"
        assert mock_get.call_args.args[0] == "https://custom.api.com/v1/models"


# ---------------------------------------------------------------------------
# detect_available_models — error handling
# ---------------------------------------------------------------------------


class TestDetectAvailableModelsErrors:
    @patch("httpx.get")
    def test_401_raises_authentication_error(self, mock_get):
        mock_get.return_value = _make_response(401)

        with pytest.raises(AuthenticationError) as exc_info:
            detect_available_models(base_url="https://api/v1", api_key="bad")

        assert exc_info.value.status_code == 401

    @patch("httpx.get")
    def test_404_raises_endpoint_not_supported(self, mock_get):
        mock_get.return_value = _make_response(404)

        with pytest.raises(EndpointNotSupportedError) as exc_info:
            detect_available_models(base_url="https://api/v1", api_key="k")

        assert exc_info.value.status_code == 404

    @patch("httpx.get")
    def test_500_raises_model_detection_error(self, mock_get):
        mock_get.return_value = _make_response(500)

        with pytest.raises(ModelDetectionError) as exc_info:
            detect_available_models(base_url="https://api/v1", api_key="k")

        # A plain 500 is a generic failure, not a 401/404 subclass.
        assert not isinstance(
            exc_info.value, (AuthenticationError, EndpointNotSupportedError)
        )
        assert exc_info.value.status_code == 500

    @patch("httpx.get")
    def test_timeout_raises_timeout_error(self, mock_get):
        import httpx

        mock_get.side_effect = httpx.TimeoutException("timed out")

        with pytest.raises(ModelDetectionTimeoutError):
            detect_available_models(base_url="https://api/v1", api_key="k")

    @patch("httpx.get")
    def test_connect_error_raises_model_detection_error(self, mock_get):
        import httpx

        mock_get.side_effect = httpx.ConnectError("connection refused")

        with pytest.raises(ModelDetectionError) as exc_info:
            detect_available_models(base_url="https://api/v1", api_key="k")

        # ConnectError is not a timeout, so it must map to the base error.
        assert not isinstance(exc_info.value, ModelDetectionTimeoutError)

    @patch("httpx.get")
    def test_non_json_response_raises(self, mock_get):
        mock_get.return_value = _make_response(200, json_payload=None)

        with pytest.raises(ModelDetectionError):
            detect_available_models(base_url="https://api/v1", api_key="k")

    @patch("httpx.get")
    def test_missing_data_key_raises(self, mock_get):
        mock_get.return_value = _make_response(200, {"not_data": []})

        with pytest.raises(ModelDetectionError):
            detect_available_models(base_url="https://api/v1", api_key="k")

    @patch("httpx.get")
    def test_data_not_a_list_raises(self, mock_get):
        mock_get.return_value = _make_response(200, {"data": "not-a-list"})

        with pytest.raises(ModelDetectionError):
            detect_available_models(base_url="https://api/v1", api_key="k")

    @patch("httpx.get")
    def test_other_4xx_raises_generic_error(self, mock_get):
        mock_get.return_value = _make_response(429)

        with pytest.raises(ModelDetectionError) as exc_info:
            detect_available_models(base_url="https://api/v1", api_key="k")

        assert exc_info.value.status_code == 429


# ---------------------------------------------------------------------------
# detect_available_models — provider fallback (static models)
# ---------------------------------------------------------------------------


class TestDetectAvailableModelsProviderFallback:
    @patch("httpx.get")
    def test_anthropic_provider_returns_static_no_network(self, mock_get):
        result = detect_available_models(
            base_url="https://api.anthropic.com",
            api_key="key",
            provider="anthropic",
        )

        assert len(result) == len(STATIC_MODELS["anthropic"])
        assert [m.id for m in result] == sorted(
            m.id for m in STATIC_MODELS["anthropic"]
        )
        mock_get.assert_not_called()

    @patch("httpx.get")
    def test_gemini_provider_returns_static_no_network(self, mock_get):
        result = detect_available_models(
            base_url="https://generativelanguage.googleapis.com",
            api_key="key",
            provider="gemini",
        )

        assert len(result) == len(STATIC_MODELS["gemini"])
        assert [m.id for m in result] == sorted(m.id for m in STATIC_MODELS["gemini"])
        mock_get.assert_not_called()

    @patch("httpx.get")
    def test_static_result_sorted_by_id(self, mock_get):
        result = detect_available_models(
            base_url="https://api.anthropic.com",
            api_key="key",
            provider="anthropic",
        )

        ids = [m.id for m in result]
        assert ids == sorted(ids)


# ---------------------------------------------------------------------------
# detect_models — convenience wrapper
# ---------------------------------------------------------------------------


class TestDetectModels:
    @patch("httpx.get")
    def test_known_provider_resolves_url_and_calls_endpoint(self, mock_get):
        mock_get.return_value = _make_response(
            200,
            {"data": [{"id": "gpt-4o", "owned_by": "openai"}]},
        )

        result = detect_models(provider="openai", api_key="key")

        assert len(result) == 1
        assert result[0].id == "gpt-4o"
        assert mock_get.call_args.args[0] == (f"{KNOWN_PROVIDERS['openai']}/models")

    @patch("httpx.get")
    def test_anthropic_returns_static_no_network(self, mock_get):
        result = detect_models(provider="anthropic", api_key="key")

        assert len(result) == len(STATIC_MODELS["anthropic"])
        assert [m.id for m in result] == sorted(
            m.id for m in STATIC_MODELS["anthropic"]
        )
        mock_get.assert_not_called()

    @patch("httpx.get")
    def test_gemini_returns_static_no_network(self, mock_get):
        result = detect_models(provider="gemini", api_key="key")

        assert len(result) == len(STATIC_MODELS["gemini"])
        assert [m.id for m in result] == sorted(m.id for m in STATIC_MODELS["gemini"])
        mock_get.assert_not_called()

    def test_unknown_provider_without_base_url_raises(self):
        with pytest.raises(ModelDetectionError):
            detect_models(provider="unknown_provider", api_key="key")

    @patch("httpx.get")
    def test_base_url_override_is_used(self, mock_get):
        mock_get.return_value = _make_response(200, {"data": [{"id": "x"}]})

        detect_models(
            provider="openai",
            api_key="key",
            base_url="https://custom.example.com/v1",
        )

        assert mock_get.call_args.args[0] == "https://custom.example.com/v1/models"

    @patch("httpx.get")
    def test_unknown_provider_with_base_url_works(self, mock_get):
        mock_get.return_value = _make_response(200, {"data": [{"id": "m"}]})

        result = detect_models(
            provider="unknown_provider",
            api_key="key",
            base_url="https://other.example.com/v1",
        )

        assert len(result) == 1
        assert result[0].id == "m"

    @patch("httpx.get")
    def test_propagates_errors(self, mock_get):
        mock_get.return_value = _make_response(401)

        with pytest.raises(AuthenticationError):
            detect_models(provider="openai", api_key="bad")


# ---------------------------------------------------------------------------
# Exception hierarchy & constants sanity checks
# ---------------------------------------------------------------------------


class TestExceptionsAndConstants:
    def test_subclasses_inherit_from_base(self):
        assert issubclass(AuthenticationError, ModelDetectionError)
        assert issubclass(EndpointNotSupportedError, ModelDetectionError)
        assert issubclass(ModelDetectionTimeoutError, ModelDetectionError)

    def test_base_error_message_and_status_code(self):
        err = ModelDetectionError("boom", status_code=503)
        assert err.message == "boom"
        assert err.status_code == 503

    def test_base_error_default_status_code_is_none(self):
        err = ModelDetectionError("boom")
        assert err.message == "boom"
        assert err.status_code is None

    @pytest.mark.parametrize(
        "exc_cls,expected_status",
        [
            (AuthenticationError, 401),
            (EndpointNotSupportedError, 404),
        ],
    )
    def test_exception_status_codes(self, exc_cls, expected_status):
        # Construct via the base signature (message, status_code).
        err = exc_cls("msg", status_code=expected_status)
        assert err.status_code == expected_status

    def test_str_includes_status_code_when_present(self):
        err = ModelDetectionError("boom", status_code=404)
        assert "boom" in str(err)
        assert "404" in str(err)

    def test_str_omits_status_when_none(self):
        err = ModelDetectionError("boom")
        assert str(err) == "boom"

    def test_known_providers_contains_expected(self):
        for name in ("openai", "openrouter", "groq", "together", "ollama"):
            assert name in KNOWN_PROVIDERS
            assert isinstance(KNOWN_PROVIDERS[name], str)
            assert KNOWN_PROVIDERS[name].startswith("http")

    def test_static_models_contains_anthropic_and_gemini(self):
        for name in ("anthropic", "gemini"):
            assert name in STATIC_MODELS
            assert len(STATIC_MODELS[name]) > 0
            for m in STATIC_MODELS[name]:
                assert isinstance(m, ModelInfo)
                assert m.id
