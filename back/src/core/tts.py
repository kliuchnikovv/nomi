"""Server-side text-to-speech for the experimental server voice source.

Two providers, selected by the `VOICE_TTS_PROVIDER` env var:

- ``edge`` (default) — Microsoft Edge's free online TTS via the ``edge-tts``
  library. No API key, neural RU/EN voices, no meaningful rate limit. Returns
  **MP3** (`audio/mpeg`).
- ``gemini`` — Google Gemini TTS (paid/quota-limited preview model). Returns a
  24 kHz/16-bit/mono **WAV** (`audio/wav`). Kept as a fallback (set the env var).

`synthesize()` returns a `TTSResult(audio, mime, duration_ms)`. We compute
`duration_ms` ourselves (the mobile player drives clip completion off it, so it
must not depend on the codec) — for MP3 from the constant bitrate, for WAV from
the PCM byte length.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import re
import time
import wave
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class TTSResult:
    audio: bytes
    mime: str
    duration_ms: int


# --- Edge TTS (default, free) ------------------------------------------------

# edge-tts default output is `audio-24khz-48kbitrate-mono-mp3` → 48 kbit/s mono,
# i.e. 6000 bytes/sec. Lets us compute clip duration from the byte length.
_EDGE_MP3_BYTES_PER_SEC = 6000
_CYRILLIC_RE = re.compile(r"[Ѐ-ӿ]")


def _pick_edge_voice(text: str, voice: str | None) -> str:
    """Pick an Edge voice: explicit Neural voice wins, else by script (RU/EN)."""
    if voice and "Neural" in voice:
        return voice
    if _CYRILLIC_RE.search(text or ""):
        return os.getenv("VOICE_EDGE_VOICE_RU", "ru-RU-DmitryNeural")
    return os.getenv("VOICE_EDGE_VOICE_EN", "en-US-AriaNeural")


async def _edge_synthesize(text: str, voice: str | None) -> tuple[bytes, str, int]:
    import edge_tts  # lazy: only needed when provider == "edge"

    edge_voice = _pick_edge_voice(text, voice)
    comm = edge_tts.Communicate(text, edge_voice)
    chunks: list[bytes] = []
    async for chunk in comm.stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            chunks.append(chunk["data"])
    audio = b"".join(chunks)
    if not audio:
        raise RuntimeError(f"edge-tts returned no audio (voice={edge_voice})")
    duration_ms = round(len(audio) / _EDGE_MP3_BYTES_PER_SEC * 1000)
    return audio, "audio/mpeg", duration_ms


# --- Gemini TTS (fallback) ---------------------------------------------------

# The TTS preview models intermittently return 500 INTERNAL ("Please retry").
# Retry a few times with backoff before giving up.
_MAX_ATTEMPTS = 3
_BACKOFF_SEC = 0.6

# Preview TTS model. `gemini-3.1-flash-tts-preview` is newer; override via env
# if the project's key has access and you want to try it.
TTS_MODEL = os.getenv("VOICE_TTS_MODEL", "gemini-2.5-flash-preview-tts")
# Default prebuilt voice. Gemini voices are multilingual; the spoken language is
# auto-detected from the input text, so the same voice serves RU and EN.
DEFAULT_VOICE = os.getenv("VOICE_TTS_VOICE", "Kore")

# Gemini TTS audio output format (fixed by the API).
_SAMPLE_RATE = 24000
_SAMPLE_WIDTH = 2  # 16-bit
_CHANNELS = 1
# 24 kHz * 2 bytes * 1 channel = 48000 bytes/sec → 48 bytes per millisecond.
_WAV_BYTES_PER_MS = _SAMPLE_RATE * _SAMPLE_WIDTH * _CHANNELS // 1000

_client = None  # type: ignore[var-annotated]


class _RetryableTTSError(Exception):
    """Internal marker for a TTS failure worth retrying."""


def _get_client():
    global _client
    if _client is None:
        from google import genai

        key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not key:
            raise ValueError("GOOGLE_API_KEY environment variable not set")
        _client = genai.Client(api_key=key)
    return _client


def _pcm_to_wav(pcm: bytes) -> bytes:
    """Wrap raw 24 kHz/16-bit/mono PCM in a WAV container."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(_CHANNELS)
        wav.setsampwidth(_SAMPLE_WIDTH)
        wav.setframerate(_SAMPLE_RATE)
        wav.writeframes(pcm)
    return buf.getvalue()


def _extract_pcm(response) -> bytes:
    """Pull the audio bytes out of the response, searching all parts.

    The preview TTS model occasionally emits a text part instead of audio; in
    that case there is no inline_data and we raise so the caller retries.
    """
    for candidate in response.candidates or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            inline = getattr(part, "inline_data", None)
            if inline and inline.data:
                return inline.data
    raise _RetryableTTSError("Gemini TTS returned no audio data (text part?)")


def _is_retryable(e: Exception) -> bool:
    from google.genai import errors

    if isinstance(e, (errors.ServerError, _RetryableTTSError)):
        return True
    # The preview model intermittently 400s with this exact message when it
    # tries to emit text instead of audio — retrying usually succeeds.
    return "should only be used for TTS" in str(e)


def _gemini_generate(text: str, voice: str) -> bytes:
    from google.genai import types

    response = _get_client().models.generate_content(
        model=TTS_MODEL,
        contents=text,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=voice,
                    ),
                ),
            ),
        ),
    )
    return _pcm_to_wav(_extract_pcm(response))


def _gemini_synthesize_wav(text: str, voice: str | None = None) -> bytes:
    """Synthesize `text` to a WAV byte string using Gemini TTS (with retries)."""
    voice = voice or DEFAULT_VOICE
    last_err: Exception | None = None
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            return _gemini_generate(text, voice)
        except Exception as e:
            if not _is_retryable(e):
                raise
            last_err = e
            logger.warning(
                "Gemini TTS retryable failure (model=%s, attempt %d/%d): %s",
                TTS_MODEL,
                attempt,
                _MAX_ATTEMPTS,
                e,
            )
            if attempt < _MAX_ATTEMPTS:
                time.sleep(_BACKOFF_SEC * attempt)
    raise last_err  # type: ignore[misc]


# --- Public API --------------------------------------------------------------


async def synthesize(text: str, voice: str | None = None) -> TTSResult:
    """Synthesize `text` to speech using the configured provider.

    Returns the raw audio bytes, their mime type, and the clip duration in ms
    (computed here so the client's playback timer is codec-agnostic).
    """
    provider = os.getenv("VOICE_TTS_PROVIDER", "edge").lower()
    if provider == "gemini":
        wav = await asyncio.to_thread(_gemini_synthesize_wav, text, voice)
        duration_ms = round(max(0, len(wav) - 44) / _WAV_BYTES_PER_MS)
        return TTSResult(wav, "audio/wav", duration_ms)
    audio, mime, duration_ms = await _edge_synthesize(text, voice)
    return TTSResult(audio, mime, duration_ms)
