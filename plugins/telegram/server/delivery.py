"""
Telegram delivery handler — sends completed AI responses to Telegram chats.
Registered automatically by the plugin loader.
Also persists assistant messages in plugin_data for history display.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)


class TelegramDeliveryHandler:
    """Delivers buffered AI response text to a Telegram chat
    and saves it to plugin_data for the plugin screen."""

    async def deliver(self, text: str, context: dict[str, Any]) -> None:
        chat_id = context.get("telegram_chat_id")
        user_id = context.get("user_id")
        if not text or not chat_id:
            return
        try:
            from plugins.telegram.server.service import get_service

            service = get_service()
            if service.enabled:
                # Step 1: Save assistant message to plugin_data first
                # This ensures the message appears in the app immediately
                if user_id:
                    await service.save_assistant_message(
                        user_id=user_id,
                        telegram_chat_id=int(chat_id),
                        text=text,
                    )
                    logger.info(
                        "Saved assistant message to plugin_data for chat_id=%s",
                        chat_id,
                    )

                # Step 2: Send to Telegram
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
