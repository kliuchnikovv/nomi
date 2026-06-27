"""
Telegram delivery handler — sends completed AI responses to Telegram chats.
Registered automatically by the plugin loader.
Also persists assistant messages in plugin_data for history display.
"""

import html
import logging
from typing import Any

logger = logging.getLogger(__name__)


class TelegramDeliveryHandler:
    """Delivers buffered AI response text to a Telegram chat
    and saves it to plugin_data for the plugin screen."""

    async def deliver(self, text: str, context: dict[str, Any]) -> None:
        chat_id = context.get("telegram_chat_id")
        user_id = context.get("user_id")
        inline_message_id = context.get("telegram_inline_message_id")
        inline_query = context.get("telegram_inline_query") or ""
        if not text or (not chat_id and not inline_message_id):
            return
        try:
            from plugins.telegram.server.service import get_service

            service = get_service()
            if not service.enabled:
                return

            # Step 1: Save assistant message to plugin_data first so it appears
            # in the app immediately. Keyed by chat_id (the user's conversation).
            if user_id and chat_id:
                await service.save_assistant_message(
                    user_id=user_id,
                    telegram_chat_id=int(chat_id),
                    text=text,
                )
                logger.info(
                    "Saved assistant message to plugin_data for chat_id=%s",
                    chat_id,
                )

            # Step 2: Deliver to Telegram.
            if inline_message_id:
                # Edit the inline placeholder in place — the answer appears in the
                # chat where the inline query was used. Keep the question visible.
                body = text
                if inline_query:
                    body = f"<b>❓ {html.escape(inline_query)}</b>\n\n{text}"
                await service.edit_inline_message(inline_message_id, body)
                logger.info(
                    "Delivered inline response (inline_message_id=%s, text_len=%d)",
                    inline_message_id,
                    len(text),
                )
            elif chat_id:
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
