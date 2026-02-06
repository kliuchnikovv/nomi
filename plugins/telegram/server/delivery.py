"""
Telegram delivery handler — sends completed AI responses to Telegram chats.
Registered automatically by the plugin loader.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)


class TelegramDeliveryHandler:
    """Delivers buffered AI response text to a Telegram chat."""

    async def deliver(self, text: str, context: dict[str, Any]) -> None:
        chat_id = context.get("telegram_chat_id")
        if not text or not chat_id:
            return
        try:
            from plugins.telegram.server.service import get_service

            service = get_service()
            if service.enabled:
                await service.send_message(int(chat_id), text, parse_mode="HTML")
                logger.info(
                    "Delivered response to Telegram chat_id=%s, text_len=%d",
                    chat_id,
                    len(text),
                )
        except Exception as e:
            logger.error("Failed to deliver to Telegram: %s", e)

    def should_buffer(self) -> bool:
        return True
