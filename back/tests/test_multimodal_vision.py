"""Tests for multimodal vision: Image format fix and vision gating."""

import base64
import sys
import types
from unittest.mock import MagicMock


# Install a real Image stub so we can inspect format/mime_type after construction
class _StubImage:
    def __init__(self, content=None, format=None, mime_type=None, **kwargs):
        self.content = content
        self.format = format
        self.mime_type = mime_type
        for k, v in kwargs.items():
            setattr(self, k, v)


# Override the MagicMock stub from conftest with our inspectable version
_media_mod = sys.modules.get("agno.media")
if _media_mod is not None:
    _media_mod.Image = _StubImage
else:
    _media_mod = types.ModuleType("agno.media")
    _media_mod.Image = _StubImage
    sys.modules["agno.media"] = _media_mod

# Re-import redis_session so it picks up the new Image class
# (conftest has already mocked all heavy deps, so import is safe)
if "src.server.redis_session" in sys.modules:
    del sys.modules["src.server.redis_session"]

from src.server.redis_session import RedisSession  # noqa: E402


def _make_session() -> RedisSession:
    factory = MagicMock()
    return RedisSession(
        agent_factory=factory,
        session_id="test-session",
        user_id="user-1",
        chat_id="chat-1",
    )


def _b64_png() -> str:
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00"
        b"\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18"
        b"\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    return base64.b64encode(png_bytes).decode()


class TestProcessAttachments:
    def test_format_is_short_form_not_mime(self):
        """Image.format must be 'jpeg' not 'image/jpeg'."""
        session = _make_session()
        attachments = [{"file_type": "image/jpeg", "content": _b64_png()}]
        images = session._process_attachments(attachments)
        assert len(images) == 1
        assert images[0].format == "jpeg"

    def test_mime_type_is_set(self):
        """Image.mime_type must be the full MIME string."""
        session = _make_session()
        attachments = [{"file_type": "image/png", "content": _b64_png()}]
        images = session._process_attachments(attachments)
        assert images[0].mime_type == "image/png"

    def test_non_image_attachments_skipped(self):
        """Non-image file_types must be ignored."""
        session = _make_session()
        attachments = [{"file_type": "application/pdf", "content": "aGVsbG8="}]
        images = session._process_attachments(attachments)
        assert images == []

    def test_missing_content_skipped(self):
        """Attachment with no content must be skipped silently."""
        session = _make_session()
        attachments = [{"file_type": "image/jpeg"}]
        images = session._process_attachments(attachments)
        assert images == []
