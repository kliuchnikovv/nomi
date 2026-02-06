"""
Telegram plugin service — handles webhook processing, account linking,
and message delivery. All Telegram business logic lives here, not in the Go API.

Uses the generic plugin_data table for storage instead of a dedicated telegram_users table.
"""

import json
import logging
import os
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import aiohttp
import redis.asyncio as redis

logger = logging.getLogger(__name__)

TELEGRAM_API_BASE = "https://api.telegram.org"
LINK_CODE_TTL = 600  # 10 minutes
LINK_CODE_PREFIX = "telegram:code:"
PLUGIN_NAME = "telegram"
RECORD_TYPE_LINKED_ACCOUNT = "linked_account"


class TelegramService:
    """Core Telegram service for the plugin."""

    def __init__(self):
        self.bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "")
        self.base_url = f"{TELEGRAM_API_BASE}/bot{self.bot_token}" if self.bot_token else ""
        self._redis: Optional[redis.Redis] = None

    @property
    def enabled(self) -> bool:
        return bool(self.bot_token)

    async def _get_redis(self) -> redis.Redis:
        if self._redis is None:
            redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
            self._redis = redis.from_url(redis_url, decode_responses=True)
        return self._redis

    async def _get_db_conn(self):
        """Get an asyncpg connection to the database."""
        import asyncpg

        db_dsn = os.getenv("DB_DSN", "")
        if db_dsn.startswith("postgres://"):
            db_dsn = db_dsn.replace("postgres://", "postgresql://", 1)
        return await asyncpg.connect(db_dsn)

    # ─── Telegram Bot API ────────────────────────────────

    async def send_message(self, chat_id: int, text: str, parse_mode: str = "HTML") -> Dict[str, Any]:
        """Send a text message to a Telegram chat."""
        return await self._call_api("sendMessage", {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": parse_mode,
        })

    async def _call_api(self, method: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Make a request to Telegram Bot API."""
        url = f"{self.base_url}/{method}"
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=data, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                result = await resp.json()
                if not result.get("ok"):
                    error_desc = result.get("description", "Unknown error")
                    logger.error("Telegram API error: %s - %s", resp.status, error_desc)
                    raise Exception(f"Telegram API error: {resp.status} - {error_desc}")
                return result.get("result", {})

    # ─── Webhook Registration ─────────────────────────────

    async def register_webhook(self) -> bool:
        """Register the webhook URL with Telegram Bot API."""
        base_url = os.getenv("WEBHOOK_BASE_URL", "")
        if not base_url:
            logger.warning("WEBHOOK_BASE_URL not set, skipping Telegram webhook registration")
            return False

        webhook_url = f"{base_url}/api/webhooks/telegram"
        try:
            await self._call_api("setWebhook", {"url": webhook_url})
            logger.info("Telegram webhook registered: %s", webhook_url)
            return True
        except Exception as e:
            logger.error("Failed to register Telegram webhook: %s", e)
            return False

    async def get_webhook_info(self) -> Dict[str, Any]:
        """Get current webhook info from Telegram."""
        return await self._call_api("getWebhookInfo", {})

    # ─── Link Code Generation ────────────────────────────

    async def generate_link_code(
        self,
        telegram_chat_id: int,
        telegram_user_id: int,
        username: str,
        first_name: str,
    ) -> str:
        """Generate a 6-digit code for the Telegram user to enter in the app."""
        code = f"{secrets.randbelow(1000000):06d}"
        info = json.dumps({
            "telegram_chat_id": telegram_chat_id,
            "telegram_user_id": telegram_user_id,
            "username": username,
            "first_name": first_name,
        })

        r = await self._get_redis()
        key = LINK_CODE_PREFIX + code
        await r.set(key, info, ex=LINK_CODE_TTL)
        logger.info("Generated link code for telegram_chat_id=%d", telegram_chat_id)
        return code

    async def validate_link_code(self, code: str) -> Optional[Dict[str, Any]]:
        """Validate a 6-digit code. Returns Telegram user info or None."""
        if len(code) != 6 or not code.isdigit():
            return None

        r = await self._get_redis()
        key = LINK_CODE_PREFIX + code
        info_str = await r.get(key)
        if not info_str:
            return None

        await r.delete(key)
        return json.loads(info_str)

    # ─── Account Linking (plugin_data table) ──────────────

    async def link_user(
        self,
        user_id: str,
        telegram_chat_id: int,
        telegram_user_id: int,
        username: str,
        first_name: str,
    ) -> Dict[str, Any]:
        """Link a Telegram account to a Genie user.
        Creates a record in plugin_data table and a Genie chat.
        """
        import uuid

        conn = await self._get_db_conn()
        try:
            # Check if already linked
            existing = await conn.fetchrow(
                """SELECT id, data FROM plugin_data
                   WHERE plugin_name = $1 AND record_type = $2
                     AND data->>'telegram_chat_id' = $3""",
                PLUGIN_NAME, RECORD_TYPE_LINKED_ACCOUNT, str(telegram_chat_id),
            )
            if existing:
                # Update info
                old_data = json.loads(existing["data"])
                old_data["username"] = username
                old_data["first_name"] = first_name
                await conn.execute(
                    "UPDATE plugin_data SET data = $1::jsonb, updated_at = NOW() WHERE id = $2",
                    json.dumps(old_data), existing["id"],
                )
                return {
                    "id": str(existing["id"]),
                    "chat_id": old_data.get("chat_id", ""),
                    "username": username,
                    "first_name": first_name,
                }

            # Create a Genie chat for this Telegram conversation
            chat_id = uuid.uuid4()
            title = f"Telegram: @{username}" if username else f"Telegram: {first_name}"
            await conn.execute(
                """INSERT INTO chats (id, user_id, model, title, mode, created_at, updated_at)
                   VALUES ($1, $2::uuid, 'default', $3, 'agent', NOW(), NOW())""",
                chat_id, user_id, title,
            )

            # Create the plugin_data record
            pd_id = uuid.uuid4()
            data = json.dumps({
                "telegram_chat_id": telegram_chat_id,
                "telegram_user_id": telegram_user_id,
                "username": username,
                "first_name": first_name,
                "chat_id": str(chat_id),
            })
            await conn.execute(
                """INSERT INTO plugin_data (id, user_id, plugin_name, record_type, data, created_at, updated_at)
                   VALUES ($1, $2::uuid, $3, $4, $5::jsonb, NOW(), NOW())""",
                pd_id, user_id, PLUGIN_NAME, RECORD_TYPE_LINKED_ACCOUNT, data,
            )

            logger.info("Linked telegram user: user_id=%s, telegram_chat_id=%d, chat_id=%s",
                         user_id, telegram_chat_id, chat_id)

            return {
                "id": str(pd_id),
                "chat_id": str(chat_id),
                "username": username,
                "first_name": first_name,
            }
        finally:
            await conn.close()

    async def get_link_status(self, user_id: str) -> Dict[str, Any]:
        """Check if a Genie user has a linked Telegram account."""
        conn = await self._get_db_conn()
        try:
            row = await conn.fetchrow(
                """SELECT data FROM plugin_data
                   WHERE user_id = $1::uuid AND plugin_name = $2 AND record_type = $3""",
                user_id, PLUGIN_NAME, RECORD_TYPE_LINKED_ACCOUNT,
            )
            if not row:
                return {"linked": False}

            data = json.loads(row["data"])
            username = data.get("username", "")
            first_name = data.get("first_name", "")
            display_name = f"@{username}" if username else first_name
            return {
                "linked": True,
                "username": username,
                "first_name": first_name,
                "display_name": display_name,
            }
        finally:
            await conn.close()

    # ─── Webhook Processing ──────────────────────────────

    async def handle_webhook(self, update: Dict[str, Any]) -> None:
        """Process an incoming Telegram webhook update."""
        if "callback_query" in update and update["callback_query"]:
            await self._handle_callback_query(update["callback_query"])
            return

        message = update.get("message")
        if not message:
            return

        chat_id = message["chat"]["id"]
        text = message.get("text", "")

        if text.startswith("/start"):
            await self._handle_start(chat_id, message)
            return

        await self._handle_regular_message(chat_id, message)

    async def _handle_start(self, chat_id: int, message: Dict[str, Any]) -> None:
        """Handle /start command — generate a link code."""
        conn = await self._get_db_conn()
        try:
            existing = await conn.fetchrow(
                """SELECT id FROM plugin_data
                   WHERE plugin_name = $1 AND record_type = $2
                     AND data->>'telegram_chat_id' = $3""",
                PLUGIN_NAME, RECORD_TYPE_LINKED_ACCOUNT, str(chat_id),
            )
        finally:
            await conn.close()

        if existing:
            await self.send_message(
                chat_id,
                "Your account is already linked! 🎉\n\nYou can send messages here and I'll respond with AI-powered answers.",
            )
            return

        from_user = message.get("from", {})
        username = from_user.get("username", "")
        first_name = from_user.get("first_name", "")
        user_id = from_user.get("id", 0)

        code = await self.generate_link_code(chat_id, user_id, username, first_name)

        await self.send_message(
            chat_id,
            f"Welcome to Genie Bot! 🧞\n\nYour linking code:\n\n<b>{code}</b>\n\n"
            f"Enter this code in the Genie app:\nSettings → Integrations → Telegram\n\n"
            f"The code expires in 10 minutes.",
        )

    async def _handle_regular_message(self, chat_id: int, message: Dict[str, Any]) -> None:
        """Forward a regular Telegram message to the AI via Redis pub/sub."""
        import uuid

        conn = await self._get_db_conn()
        try:
            row = await conn.fetchrow(
                """SELECT user_id, data FROM plugin_data
                   WHERE plugin_name = $1 AND record_type = $2
                     AND data->>'telegram_chat_id' = $3""",
                PLUGIN_NAME, RECORD_TYPE_LINKED_ACCOUNT, str(chat_id),
            )
        finally:
            await conn.close()

        if not row:
            await self.send_message(
                chat_id,
                "Your account is not linked. Send /start to get a link code.",
            )
            return

        data = json.loads(row["data"])
        genie_user_id = str(row["user_id"])
        genie_chat_id = data.get("chat_id", "")
        text = message.get("text", "")
        if not text:
            photos = message.get("photo")
            if photos:
                text = "[Photo received]"
            else:
                return

        r = await self._get_redis()
        message_id = str(uuid.uuid4())
        frame = {
            "id": 0,
            "chat_id": genie_chat_id,
            "kind": "data",
            "op": "message",
            "ts": datetime.now(timezone.utc).isoformat(),
            "payload": {
                "message_id": message_id,
                "message": text,
                "role": "user",
                "trace_id": str(uuid.uuid4()),
                "user_id": genie_user_id,
                "source": "telegram",
                "telegram_chat_id": chat_id,
            },
        }
        channel = f"chat:request:{genie_chat_id}"
        await r.publish(channel, json.dumps(frame))
        logger.info("Published telegram message to %s (user=%s)", channel, genie_user_id)

    async def _handle_callback_query(self, query: Dict[str, Any]) -> None:
        """Handle inline button press as a regular message."""
        message = query.get("message")
        if not message:
            return

        chat_id = message["chat"]["id"]
        data = query.get("data", "")

        fake_message = {
            "from": query.get("from", {}),
            "chat": {"id": chat_id},
            "text": data,
        }
        await self._handle_regular_message(chat_id, fake_message)

    async def close(self) -> None:
        """Close resources."""
        if self._redis:
            await self._redis.close()


# ─── Singleton ────────────────────────────────────────

_service: Optional[TelegramService] = None


def get_service() -> TelegramService:
    """Get the singleton TelegramService instance."""
    global _service
    if _service is None:
        _service = TelegramService()
    return _service
