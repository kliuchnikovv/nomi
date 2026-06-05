"""
Speech-to-text transcription using faster-whisper (open-source, local).

Used to transcribe voice messages (e.g. from the Telegram plugin) without
relying on any external paid API. The model runs locally and is loaded
lazily as a process-wide singleton.

Configuration (all via environment variables):
- STT_ENABLED        — global on/off switch (default "true")
- STT_MODEL          — whisper model size: tiny/base/small/medium (default "small")
- STT_DEVICE         — "cpu" or "cuda" (default "cpu")
- STT_COMPUTE_TYPE   — CTranslate2 compute type (default "int8")
- STT_LANGUAGE       — force a language code (e.g. "ru"); empty = auto-detect
"""

import asyncio
import io
import logging
import os

logger = logging.getLogger(__name__)

_model = None  # lazily-initialized faster_whisper.WhisperModel singleton


def is_stt_enabled() -> bool:
    """Whether speech-to-text is enabled."""
    return os.getenv("STT_ENABLED", "true").lower() not in ("false", "0", "no")


def _get_model():
    """Lazily load and cache the Whisper model."""
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        model_size = os.getenv("STT_MODEL", "small")
        device = os.getenv("STT_DEVICE", "cpu")
        compute_type = os.getenv("STT_COMPUTE_TYPE", "int8")
        logger.info(
            "Loading Whisper model '%s' (device=%s, compute_type=%s)",
            model_size,
            device,
            compute_type,
        )
        _model = WhisperModel(model_size, device=device, compute_type=compute_type)
    return _model


def _transcribe_sync(audio: bytes) -> str:
    """Blocking transcription — run inside a thread."""
    model = _get_model()
    language = os.getenv("STT_LANGUAGE", "").strip() or None
    segments, _info = model.transcribe(io.BytesIO(audio), language=language)
    return "".join(segment.text for segment in segments).strip()


async def transcribe(audio: bytes) -> str:
    """Transcribe audio bytes (any format ffmpeg/PyAV can decode, incl. OGG/Opus).

    Returns the recognized text, or an empty string if STT is disabled,
    the audio is empty, or transcription fails.
    """
    if not is_stt_enabled():
        logger.info("STT disabled, skipping transcription")
        return ""
    if not audio:
        return ""
    try:
        return await asyncio.to_thread(_transcribe_sync, audio)
    except Exception as e:  # noqa: BLE001 - degrade gracefully on any STT error
        logger.error("Transcription failed: %s", e, exc_info=True)
        return ""
