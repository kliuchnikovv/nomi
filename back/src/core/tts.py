"""Server-side text-to-speech via Gemini.

Used by the experimental `server_gemini` voice source: the assistant's reply
text (produced by the normal Nomi/Agno pipeline) is synthesized here, one
sentence at a time, and the resulting WAV is streamed back to the device which
plays it instead of on-device `expo-speech`.

Gemini TTS returns raw 24 kHz, 16-bit, mono PCM; we wrap it in a WAV container
so the mobile player can play it directly.
"""

from __future__ import annotations

import io
import logging
import os
import wave

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

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

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
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


def synthesize(text: str, voice: str | None = None) -> bytes:
    """Synthesize `text` to a WAV byte string using Gemini TTS.

    Raises on API/format errors; the caller maps that to an HTTP 5xx.
    """
    response = _get_client().models.generate_content(
        model=TTS_MODEL,
        contents=text,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=voice or DEFAULT_VOICE,
                    ),
                ),
            ),
        ),
    )

    pcm = response.candidates[0].content.parts[0].inline_data.data
    if not pcm:
        raise ValueError("Gemini TTS returned no audio data")
    return _pcm_to_wav(pcm)
