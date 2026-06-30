"""
Model detection utilities for listing available models from LLM providers.

Most providers (OpenAI, OpenRouter, Groq, Together, Ollama, ...) expose a
``GET {base_url}/models`` endpoint that follows the OpenAI format::

    {"data": [{"id": "...", "created": ..., "owned_by": "..."}, ...]}

A few providers (Anthropic, Google Gemini) are not OpenAI-compatible at the
models-listing level, so we ship a small curated ``STATIC_MODELS`` fallback for
those and return it directly without any network call.

Error handling maps HTTP/transport failures onto a small hierarchy of
exceptions (:class:`ModelDetectionError` and its subclasses) so callers can
react to auth failures, unsupported endpoints and timeouts individually.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


class ModelInfo(BaseModel):
    """Lightweight description of a single available model.

    Mirrors the relevant subset of the OpenAI ``/models`` list item.
    """

    id: str
    created: int | None = None
    owned_by: str | None = None


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class ModelDetectionError(Exception):
    """Base exception for any failure while detecting available models."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        """Store the human-readable ``message`` and optional ``status_code``.

        Args:
            message: Human-readable description of what went wrong.
            status_code: HTTP status code associated with the failure, if any.
        """
        super().__init__(message)
        self.message = message
        self.status_code = status_code

    def __str__(self) -> str:
        """Render the error, appending the status code when present."""
        if self.status_code is not None:
            return f"{self.message} (status {self.status_code})"
        return self.message


class AuthenticationError(ModelDetectionError):
    """Raised when the provider rejects the API key (HTTP 401)."""


class EndpointNotSupportedError(ModelDetectionError):
    """Raised when the provider has no OpenAI-compatible ``/models`` endpoint.

    Covers both HTTP 404 responses and explicitly non-OpenAI-compatible
    providers that are served from ``STATIC_MODELS``.
    """


class ModelDetectionTimeoutError(ModelDetectionError):
    """Raised when the models endpoint does not respond in time."""


# ---------------------------------------------------------------------------
# Provider presets
# ---------------------------------------------------------------------------

#: Default base URLs for known OpenAI-compatible providers.
KNOWN_PROVIDERS: dict[str, str] = {
    "openai": "https://api.openai.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "groq": "https://api.groq.com/openai/v1",
    "together": "https://api.together.xyz/v1",
    "ollama": "http://localhost:11434/v1",
}

#: Providers that are not OpenAI-compatible at the ``/models`` level. For these
#: we return a curated static list of ``ModelInfo`` instead of hitting the
#: network.
STATIC_MODELS: dict[str, list[ModelInfo]] = {
    "anthropic": [
        ModelInfo(
            id="claude-sonnet-4-20250514",
            created=1716134400,
            owned_by="anthropic",
        ),
        ModelInfo(
            id="claude-3-7-sonnet-20250219",
            created=1739836800,
            owned_by="anthropic",
        ),
        ModelInfo(
            id="claude-3-5-haiku-20241022",
            created=1729555200,
            owned_by="anthropic",
        ),
    ],
    "gemini": [
        ModelInfo(
            id="gemini-2.5-pro",
            created=1741824000,
            owned_by="google",
        ),
        ModelInfo(
            id="gemini-2.5-flash",
            created=1741824000,
            owned_by="google",
        ),
        ModelInfo(
            id="gemini-2.0-flash",
            created=1735689600,
            owned_by="google",
        ),
    ],
}

#: Request timeout (seconds) used for the ``/models`` HTTP call.
DEFAULT_TIMEOUT: float = 10.0


# ---------------------------------------------------------------------------
# Core detection
# ---------------------------------------------------------------------------


def detect_available_models(
    base_url: str,
    api_key: str,
    provider: str | None = None,
) -> list[ModelInfo]:
    """Return the list of models available for an OpenAI-compatible provider.

    If ``provider`` names a non-OpenAI-compatible provider present in
    :data:`STATIC_MODELS`, the curated static list is returned immediately and
    no network call is made. Otherwise an HTTP ``GET {base_url}/models`` request
    is issued, the OpenAI-format response is parsed, and the resulting
    :class:`ModelInfo` objects are returned sorted by ``id``.

    Args:
        base_url: Base URL of the provider API (e.g.
            ``https://api.openai.com/v1``). Must not include ``/models``.
        api_key: Bearer token used for authentication.
        provider: Optional provider name. When it maps to a ``STATIC_MODELS``
            entry (e.g. ``"anthropic"``, ``"gemini"``) the static list is
            returned without any network I/O.

    Returns:
        Models sorted alphabetically by ``id``.

    Raises:
        AuthenticationError: The provider rejected the API key (HTTP 401).
        EndpointNotSupportedError: The provider has no ``/models`` endpoint
            (HTTP 404) or is known to be non-OpenAI-compatible.
        ModelDetectionTimeoutError: The request timed out.
        ModelDetectionError: Any other HTTP or network failure.
    """
    # Non-OpenAI-compatible providers: serve the curated static list directly.
    if provider is not None and provider in STATIC_MODELS:
        logger.info(
            "Returning static model list for non-OpenAI-compatible provider %r",
            provider,
        )
        return sorted(STATIC_MODELS[provider], key=lambda m: m.id)

    url = f"{base_url.rstrip('/')}/models"
    headers = {"Authorization": f"Bearer {api_key}"}
    logger.info("Detecting available models from %s", url)

    try:
        response = httpx.get(url, headers=headers, timeout=DEFAULT_TIMEOUT)
    except httpx.TimeoutException as exc:
        logger.warning("Timed out while contacting %s: %s", url, exc)
        raise ModelDetectionTimeoutError(
            f"Timed out while listing models from {url}"
        ) from exc
    except httpx.HTTPError as exc:
        logger.warning("Network error while contacting %s: %s", url, exc)
        raise ModelDetectionError(
            f"Network error while listing models from {url}: {exc}"
        ) from exc

    status = response.status_code
    if status == 401:
        logger.warning("Authentication failed (401) for %s", url)
        raise AuthenticationError(
            "Authentication failed: invalid or missing API key", status_code=401
        )
    if status == 404:
        logger.warning("Models endpoint not found (404) for %s", url)
        raise EndpointNotSupportedError(
            f"Models endpoint not found at {url}; the provider may not be "
            "OpenAI-compatible",
            status_code=404,
        )
    if status >= 400:
        logger.warning("Provider %s returned HTTP %d", url, status)
        raise ModelDetectionError(
            f"Provider returned HTTP {status} while listing models",
            status_code=status,
        )

    try:
        payload: dict[str, Any] = response.json()
    except ValueError as exc:
        logger.warning("Non-JSON response from %s: %s", url, exc)
        raise ModelDetectionError(
            f"Provider at {url} did not return valid JSON"
        ) from exc

    data = payload.get("data")
    if not isinstance(data, list):
        logger.warning("Unexpected payload shape from %s (no 'data' list)", url)
        raise ModelDetectionError(
            f"Provider at {url} returned an unexpected payload shape "
            "(expected a 'data' list)"
        )

    models: list[ModelInfo] = []
    skipped = 0
    for entry in data:
        if not isinstance(entry, dict) or "id" not in entry:
            skipped += 1
            continue
        try:
            models.append(
                ModelInfo(
                    id=entry["id"],
                    created=entry.get("created"),
                    owned_by=entry.get("owned_by"),
                )
            )
        except (TypeError, ValueError) as exc:
            skipped += 1
            logger.debug("Skipping malformed model entry %r: %s", entry, exc)

    if skipped:
        logger.info("Skipped %d malformed model entries from %s", skipped, url)

    models.sort(key=lambda m: m.id)
    logger.info("Detected %d models from %s", len(models), url)
    return models


# ---------------------------------------------------------------------------
# Convenience wrapper
# ---------------------------------------------------------------------------


def detect_models(
    provider: str,
    api_key: str,
    base_url: str | None = None,
) -> list[ModelInfo]:
    """Convenience wrapper that resolves defaults before detection.

    The provider name is used to:

    * look up a default ``base_url`` in :data:`KNOWN_PROVIDERS` when none is
      supplied, and
    * detect non-OpenAI-compatible providers (``anthropic``, ``gemini``) whose
      curated lists live in :data:`STATIC_MODELS`.

    Args:
        provider: Provider key (e.g. ``"openai"``, ``"groq"``, ``"anthropic"``).
        api_key: Bearer token used for authentication.
        base_url: Optional override for the provider's base URL. When omitted
            the value from :data:`KNOWN_PROVIDERS` is used.

    Returns:
        Models sorted alphabetically by ``id``.

    Raises:
        ModelDetectionError: If ``base_url`` is not provided and ``provider``
            is not a known OpenAI-compatible provider.
        AuthenticationError: The provider rejected the API key.
        EndpointNotSupportedError: The provider has no ``/models`` endpoint.
        ModelDetectionTimeoutError: The request timed out.
    """
    # Non-OpenAI-compatible providers are served from STATIC_MODELS directly.
    if provider in STATIC_MODELS:
        logger.info(
            "Provider %r is non-OpenAI-compatible; returning static models",
            provider,
        )
        return sorted(STATIC_MODELS[provider], key=lambda m: m.id)

    resolved_base_url = base_url
    if resolved_base_url is None:
        resolved_base_url = KNOWN_PROVIDERS.get(provider)
    if not resolved_base_url:
        raise ModelDetectionError(
            f"No base_url provided and provider {provider!r} is not a known "
            "OpenAI-compatible provider"
        )

    return detect_available_models(
        base_url=resolved_base_url,
        api_key=api_key,
        provider=provider,
    )
