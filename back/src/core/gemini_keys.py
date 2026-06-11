"""Gemini API key pool with rotation on quota exhaustion.

Each Google Cloud project provides its own free-tier Gemini quota. We hold all
their keys and rotate to the next one when the current key is exhausted
(HTTP 429 / RESOURCE_EXHAUSTED).

Keys come from ``GEMINI_API_KEYS`` (comma-separated). Falls back to a single
``GEMINI_API_KEY`` / ``GOOGLE_API_KEY`` so existing single-key setups keep
working unchanged.
"""

from __future__ import annotations

import logging
import os
import threading

logger = logging.getLogger(__name__)


def _load_keys() -> list[str]:
    raw = os.getenv("GEMINI_API_KEYS", "")
    keys = [k.strip() for k in raw.split(",") if k.strip()]
    if not keys:
        single = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if single and single.strip():
            keys = [single.strip()]
    return keys


def is_quota_error(exc: BaseException | None) -> bool:
    """Best-effort detection of a Gemini quota / rate-limit error.

    Works across SDKs (``google.api_core.exceptions.ResourceExhausted`` raised by
    the Agno path, ``google.genai.errors.ClientError`` raised by raw ``genai``
    clients) without importing either — checks an HTTP status code attribute and
    the error text.
    """
    if exc is None:
        return False
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if code == 429:
        return True
    msg = str(exc).upper()
    return "RESOURCE_EXHAUSTED" in msg or "429" in msg


class GeminiKeyManager:
    """Process-wide, thread-safe pool of Gemini API keys with round-robin rotation."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._keys = _load_keys()
        self._idx = 0

    @property
    def count(self) -> int:
        return len(self._keys)

    def current(self) -> str:
        with self._lock:
            if not self._keys:
                raise ValueError(
                    "No Gemini API key set "
                    "(GEMINI_API_KEYS / GEMINI_API_KEY / GOOGLE_API_KEY)"
                )
            return self._keys[self._idx]

    def rotate(self, reason: str = "") -> str:
        """Advance to the next key and return it. No-op (returns current) with <2 keys."""
        with self._lock:
            if len(self._keys) <= 1:
                logger.warning(
                    "[GeminiKeys] rotate requested (%s) but only %d key(s) available",
                    reason or "no reason",
                    len(self._keys),
                )
                return self._keys[self._idx] if self._keys else ""
            self._idx = (self._idx + 1) % len(self._keys)
            logger.warning(
                "[GeminiKeys] rotated to key #%d/%d (%s)",
                self._idx + 1,
                len(self._keys),
                reason or "no reason",
            )
            return self._keys[self._idx]


# Singleton used across the backend.
KEY_MANAGER = GeminiKeyManager()
