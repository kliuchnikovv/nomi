"""
Telegram tools for server-side plugin.
Provides messaging functionality via Telegram Bot API.
"""

import json
import logging
from typing import Any, Dict, List, Optional

from agno.tools import Toolkit

logger = logging.getLogger(__name__)

TELEGRAM_API_BASE = "https://api.telegram.org"


class TelegramTools(Toolkit):
    """Telegram Bot API tools for sending messages."""

    def __init__(self, bot_token: str):
        super().__init__(name="telegram_tools")
        self.bot_token = bot_token
        self.base_url = f"{TELEGRAM_API_BASE}/bot{bot_token}"
        self.register(self.send_message)
        self.register(self.send_photo)
        self.register(self.send_buttons)

    async def _make_request(
        self, method: str, data: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """Make a request to Telegram Bot API."""
        import aiohttp

        url = f"{self.base_url}/{method}"

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=data) as response:
                result = await response.json()
                if not result.get("ok"):
                    error_desc = result.get("description", "Unknown error")
                    raise Exception(
                        f"Telegram API error: {response.status} - {error_desc}"
                    )
                return result.get("result", {})

    async def send_message(
        self,
        chat_id: int,
        text: str,
        parse_mode: str = "HTML",
    ) -> Dict[str, Any]:
        """Send a text message to a Telegram chat.

        Args:
            chat_id: Telegram chat ID
            text: Message text
            parse_mode: Parse mode (HTML or Markdown)

        Returns:
            Sent message object
        """
        data = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": parse_mode,
        }
        return await self._make_request("sendMessage", data)

    async def send_photo(
        self,
        chat_id: int,
        photo_url: str,
        caption: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send a photo to a Telegram chat.

        Args:
            chat_id: Telegram chat ID
            photo_url: URL of the photo to send
            caption: Optional photo caption

        Returns:
            Sent message object
        """
        data: Dict[str, Any] = {
            "chat_id": chat_id,
            "photo": photo_url,
        }
        if caption:
            data["caption"] = caption
        return await self._make_request("sendPhoto", data)

    async def send_buttons(
        self,
        chat_id: int,
        text: str,
        buttons: List[Dict[str, str]],
    ) -> Dict[str, Any]:
        """Send a message with inline keyboard buttons.

        Args:
            chat_id: Telegram chat ID
            text: Message text
            buttons: List of button objects with 'text' and optionally 'callback_data' or 'url'

        Returns:
            Sent message object
        """
        inline_keyboard = []
        row: List[Dict[str, str]] = []
        for btn in buttons:
            button: Dict[str, str] = {"text": btn["text"]}
            if "url" in btn and btn["url"]:
                button["url"] = btn["url"]
            elif "callback_data" in btn and btn["callback_data"]:
                button["callback_data"] = btn["callback_data"]
            else:
                button["callback_data"] = btn["text"]
            row.append(button)
        if row:
            inline_keyboard.append(row)

        data = {
            "chat_id": chat_id,
            "text": text,
            "reply_markup": json.dumps({"inline_keyboard": inline_keyboard}),
        }
        return await self._make_request("sendMessage", data)


def build(params: Dict[str, Any]) -> Toolkit:
    """Build Telegram tools from parameters.

    Expected params:
        - bot_token: Telegram Bot API token
        - OR access_token / api_key as fallbacks

    Args:
        params: Configuration parameters

    Returns:
        Configured TelegramTools instance
    """
    bot_token = (
        params.get("bot_token")
        or params.get("api_key")
        or params.get("access_token")
    )
    if not bot_token:
        raise ValueError("Telegram bot_token is required")

    logger.info("Building Telegram tools")
    return TelegramTools(bot_token=bot_token)
