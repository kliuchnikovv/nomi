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
RECORD_TYPE_MESSAGE = "message"


class TelegramService:
    """Core Telegram service for the plugin."""

    def __init__(self):
        self.bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "")
        self.base_url = (
            f"{TELEGRAM_API_BASE}/bot{self.bot_token}" if self.bot_token else ""
        )
        self._redis: Optional[redis.Redis] = None
        self._models: list[dict] = self._load_models()

    def _load_models(self) -> list[dict]:
        """Load available models from models.json config."""
        import pathlib

        # Use env var for config path to avoid path traversal outside plugin dir
        config_path = os.getenv("MODELS_CONFIG_PATH", "/app/config/models.json")

        possible_paths = [
            pathlib.Path(config_path),
        ]

        for path in possible_paths:
            if path.exists():
                try:
                    with open(path, "r") as f:
                        config = json.load(f)
                        models = config.get("models", [])
                        logger.info("Loaded %d models from %s", len(models), path)
                        return models
                except (json.JSONDecodeError, IOError) as e:
                    logger.warning("Failed to load models from %s: %s", path, e)
                    continue

        logger.error("Could not load models.json from any known location")
        return []

    def _get_model_config(self, model_id: str) -> Optional[dict]:
        """Get model configuration by ID."""
        for model in self._models:
            if model.get("id") == model_id:
                return model
        return None

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

    async def send_message(
        self, chat_id: int, text: str, parse_mode: str = "HTML"
    ) -> Dict[str, Any]:
        """Send a text message to a Telegram chat."""
        return await self._call_api(
            "sendMessage",
            {
                "chat_id": chat_id,
                "text": text,
                "parse_mode": parse_mode,
            },
        )

    async def _call_api(self, method: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Make a request to Telegram Bot API."""
        url = f"{self.base_url}/{method}"
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url, json=data, timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
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
            logger.warning(
                "WEBHOOK_BASE_URL not set, skipping Telegram webhook registration"
            )
            return False

        webhook_url = f"{base_url}/api/webhooks/telegram/webhook"
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
        info = json.dumps(
            {
                "telegram_chat_id": telegram_chat_id,
                "telegram_user_id": telegram_user_id,
                "username": username,
                "first_name": first_name,
            }
        )

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
        Creates a record in plugin_data table only — no chats table entries.
        """
        import uuid

        conn = await self._get_db_conn()
        try:
            # Check if already linked — by telegram_chat_id OR by user_id
            existing = await conn.fetchrow(
                """SELECT id, data FROM plugin_data
                   WHERE plugin_name = $1 AND record_type = $2
                     AND (data->>'telegram_chat_id' = $3 OR user_id = $4::uuid)""",
                PLUGIN_NAME,
                RECORD_TYPE_LINKED_ACCOUNT,
                str(telegram_chat_id),
                user_id,
            )
            if existing:
                # Update info, restore active=True on re-link
                old_data = json.loads(existing["data"])
                old_data["username"] = username
                old_data["first_name"] = first_name
                old_data["telegram_chat_id"] = telegram_chat_id
                old_data["telegram_user_id"] = telegram_user_id
                old_data["active"] = True
                await conn.execute(
                    "UPDATE plugin_data SET data = $1::jsonb, user_id = $2::uuid, updated_at = NOW() WHERE id = $3",
                    json.dumps(old_data),
                    user_id,
                    existing["id"],
                )
                return {
                    "id": str(existing["id"]),
                    "username": username,
                    "first_name": first_name,
                }

            # Create the plugin_data record (no chat creation — messages stay in plugin_data)
            pd_id = uuid.uuid4()
            data = json.dumps(
                {
                    "telegram_chat_id": telegram_chat_id,
                    "telegram_user_id": telegram_user_id,
                    "username": username,
                    "first_name": first_name,
                }
            )
            await conn.execute(
                """INSERT INTO plugin_data (id, user_id, plugin_name, record_type, data, created_at, updated_at)
                   VALUES ($1, $2::uuid, $3, $4, $5::jsonb, NOW(), NOW())""",
                pd_id,
                user_id,
                PLUGIN_NAME,
                RECORD_TYPE_LINKED_ACCOUNT,
                data,
            )

            logger.info(
                "Linked telegram user: user_id=%s, telegram_chat_id=%d",
                user_id,
                telegram_chat_id,
            )

            return {
                "id": str(pd_id),
                "username": username,
                "first_name": first_name,
            }
        finally:
            await conn.close()

    async def deactivate_link(self, user_id: str) -> bool:
        """Mark the Telegram linked account as inactive for a Genie user."""
        conn = await self._get_db_conn()
        try:
            row = await conn.fetchrow(
                """SELECT id, data FROM plugin_data
                   WHERE user_id = $1::uuid AND plugin_name = $2 AND record_type = $3""",
                user_id,
                PLUGIN_NAME,
                RECORD_TYPE_LINKED_ACCOUNT,
            )
            if not row:
                return False
            data = json.loads(row["data"])
            data["active"] = False
            await conn.execute(
                "UPDATE plugin_data SET data = $1::jsonb, updated_at = NOW() WHERE id = $2",
                json.dumps(data),
                row["id"],
            )
            logger.info("Deactivated telegram link for user_id=%s", user_id)
            return True
        finally:
            await conn.close()

    async def get_link_status(self, user_id: str) -> Dict[str, Any]:
        """Check if a Genie user has a linked Telegram account."""
        conn = await self._get_db_conn()
        try:
            row = await conn.fetchrow(
                """SELECT data FROM plugin_data
                   WHERE user_id = $1::uuid AND plugin_name = $2 AND record_type = $3""",
                user_id,
                PLUGIN_NAME,
                RECORD_TYPE_LINKED_ACCOUNT,
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

        if text.startswith("/reconnect"):
            await self._handle_reconnect(chat_id, message)
            return

        if text.startswith("/model"):
            await self._handle_model_command(chat_id, message)
            return

        await self._handle_regular_message(chat_id, message)

    async def _handle_start(self, chat_id: int, message: Dict[str, Any]) -> None:
        """Handle /start command — generate a link code."""
        conn = await self._get_db_conn()
        try:
            existing = await conn.fetchrow(
                """SELECT id, data FROM plugin_data
                   WHERE plugin_name = $1 AND record_type = $2
                     AND data->>'telegram_chat_id' = $3""",
                PLUGIN_NAME,
                RECORD_TYPE_LINKED_ACCOUNT,
                str(chat_id),
            )
        finally:
            await conn.close()

        if existing:
            data = json.loads(existing["data"])
            if data.get("active", True):
                await self.send_message(
                    chat_id,
                    "Your account is already linked! 🎉\n\nYou can send messages here and I'll respond with AI-powered answers.\n\nUse /reconnect to re-link your account.",
                )
                return
            # Account was deactivated — treat as new link
            await self._generate_and_send_link_code(chat_id, message)
            return

        await self._generate_and_send_link_code(chat_id, message)

    async def _handle_reconnect(self, chat_id: int, message: Dict[str, Any]) -> None:
        """Handle /reconnect command — generate a new link code regardless of current status."""
        await self._generate_and_send_link_code(chat_id, message)

    async def _generate_and_send_link_code(self, chat_id: int, message: Dict[str, Any]) -> None:
        """Generate a link code and send it to the user."""
        from_user = message.get("from", {})
        username = from_user.get("username", "")
        first_name = from_user.get("first_name", "")
        user_id = from_user.get("id", 0)

        code = await self.generate_link_code(chat_id, user_id, username, first_name)

        await self.send_message(
            chat_id,
            f"Welcome to Nomi Bot! ✨\n\nYour linking code:\n\n<b>{code}</b>\n\n"
            f"Enter this code in the Nomi app:\nSettings → Integrations → Telegram\n\n"
            f"The code expires in 10 minutes.",
        )

    async def _handle_model_command(
        self, chat_id: int, message: Dict[str, Any]
    ) -> None:
        """Handle /model command — show inline keyboard with available models."""
        conn = await self._get_db_conn()
        try:
            row = await conn.fetchrow(
                """SELECT id, data FROM plugin_data
                   WHERE plugin_name = $1 AND record_type = $2
                     AND data->>'telegram_chat_id' = $3""",
                PLUGIN_NAME,
                RECORD_TYPE_LINKED_ACCOUNT,
                str(chat_id),
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
        selected_model = data.get("selected_model", "")

        # Group models by provider
        models_by_provider: dict[str, list[dict]] = {}
        for model in self._models:
            provider = model.get("provider", "unknown")
            if provider not in models_by_provider:
                models_by_provider[provider] = []
            models_by_provider[provider].append(model)

        # Build keyboard with providers only (2 per row)
        keyboard = []
        providers = sorted(models_by_provider.keys())

        # Add info about current selection
        current_text = (
            f"Current: {selected_model}" if selected_model else "No model selected"
        )

        # Create rows with 2 provider buttons each
        for i in range(0, len(providers), 2):
            row = []
            for provider in providers[i : i + 2]:
                row.append(
                    {
                        "text": provider.upper(),
                        "callback_data": f"model:provider:{provider}",
                    }
                )
            keyboard.append(row)

        logger.info(
            "Sending provider keyboard with %d rows to chat_id=%d",
            len(keyboard),
            chat_id,
        )

        try:
            result = await self._call_api(
                "sendMessage",
                {
                    "chat_id": chat_id,
                    "text": f"<b>Select AI Model Provider</b>\n\n{current_text}\n\nChoose a provider:",
                    "parse_mode": "HTML",
                    "reply_markup": {"inline_keyboard": keyboard},
                },
            )
            logger.info("Provider keyboard sent successfully: %s", result)
        except Exception as e:
            logger.error("Failed to send provider keyboard: %s", e)
            # Fallback: send simple message without keyboard
            await self.send_message(
                chat_id,
                f"Use /model <model_id> to select a model. Available models: {len(self._models)}",
            )

    async def _handle_regular_message(
        self, chat_id: int, message: Dict[str, Any]
    ) -> None:
        """Forward a regular Telegram message to the AI via Redis pub/sub.
        Messages are stored in plugin_data (not in the messages table).
        """
        import uuid

        conn = await self._get_db_conn()
        try:
            row = await conn.fetchrow(
                """SELECT user_id, data FROM plugin_data
                   WHERE plugin_name = $1 AND record_type = $2
                     AND data->>'telegram_chat_id' = $3""",
                PLUGIN_NAME,
                RECORD_TYPE_LINKED_ACCOUNT,
                str(chat_id),
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

        if not data.get("active", True):
            await self.send_message(
                chat_id,
                "Your Genie integration has been disconnected.\n\nSend /reconnect to link your account again.",
            )
            return

        genie_user_id = str(row["user_id"])
        text = message.get("text", "")
        if not text:
            photos = message.get("photo")
            if photos:
                text = "[Photo received]"
            else:
                return

        # Get selected model from plugin_data
        selected_model = data.get("selected_model", "")
        model_config = (
            self._get_model_config(selected_model) if selected_model else None
        )

        message_id = str(uuid.uuid4())

        # Save user message to plugin_data
        conn2 = await self._get_db_conn()
        try:
            await conn2.execute(
                """INSERT INTO plugin_data (id, user_id, plugin_name, record_type, data, created_at, updated_at)
                   VALUES ($1, $2::uuid, $3, $4, $5::jsonb, NOW(), NOW())""",
                uuid.uuid4(),
                genie_user_id,
                PLUGIN_NAME,
                RECORD_TYPE_MESSAGE,
                json.dumps({
                    "telegram_chat_id": chat_id,
                    "role": "user",
                    "text": text,
                }),
            )
        except Exception as e:
            logger.error("Failed to save user message to plugin_data: %s", e)
        finally:
            await conn2.close()

        # Load chat history from plugin_data for context
        history: list[dict] = []
        conn3 = await self._get_db_conn()
        try:
            rows = await conn3.fetch(
                """SELECT data FROM plugin_data
                   WHERE plugin_name = $1 AND record_type = $2
                     AND user_id = $3::uuid
                     AND data->>'telegram_chat_id' = $4
                   ORDER BY created_at ASC
                   LIMIT 50""",
                PLUGIN_NAME,
                RECORD_TYPE_MESSAGE,
                genie_user_id,
                str(chat_id),
            )
            for r in rows:
                msg_data = json.loads(r["data"])
                history.append({
                    "role": msg_data.get("role", "user"),
                    "content": msg_data.get("text", ""),
                })
        except Exception as e:
            logger.error("Failed to load chat history from plugin_data: %s", e)
        finally:
            await conn3.close()

        # Use a virtual chat_id based on the telegram_chat_id (not a real chat)
        virtual_chat_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"telegram:{chat_id}"))

        r = await self._get_redis()
        frame = {
            "id": 0,
            "chat_id": virtual_chat_id,
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
                "model": selected_model,
                "endpoint": model_config.get("endpoint", "") if model_config else "",
                "streaming": model_config.get("streaming", False)
                if model_config
                else False,
                "history": history,
            },
        }
        channel = f"chat:request:{virtual_chat_id}"
        await r.publish(channel, json.dumps(frame))
        logger.info(
            "Published telegram message to %s (user=%s, model=%s)",
            channel,
            genie_user_id,
            selected_model or "default",
        )

    async def _handle_callback_query(self, query: Dict[str, Any]) -> None:
        """Handle inline button press."""
        message = query.get("message")
        if not message:
            return

        chat_id = message["chat"]["id"]
        callback_data = query.get("data", "")
        query_id = query.get("id", "")

        # Handle model selection callbacks
        if callback_data.startswith("model:"):
            parts = callback_data.split(":")

            if len(parts) >= 3 and parts[1] == "provider":
                # Show models for selected provider
                provider = parts[2]
                await self._show_provider_models(chat_id, query_id, provider)
                return

            model_id = parts[1] if len(parts) > 1 else ""

            if model_id == "noop":
                # Provider header - just dismiss the loading spinner
                await self._answer_callback(query_id)
                return

            if model_id == "back":
                # Back to main model selection
                await self._answer_callback(query_id)
                fake_message = {
                    "from": query.get("from", {}),
                    "chat": {"id": chat_id},
                    "text": "/model",
                }
                await self._handle_model_command(chat_id, fake_message)
                return

            # Set the selected model
            await self._set_model(chat_id, model_id)
            await self._answer_callback(query_id, f"Model: {model_id}")
            return

        # Handle regular message callbacks (existing behavior)
        fake_message = {
            "from": query.get("from", {}),
            "chat": {"id": chat_id},
            "text": callback_data,
        }
        await self._handle_regular_message(chat_id, fake_message)

    async def _answer_callback(self, query_id: str, text: str = "") -> None:
        """Answer a callback query to dismiss Telegram's loading spinner."""
        data: dict[str, Any] = {"callback_query_id": query_id}
        if text:
            data["text"] = text
        try:
            await self._call_api("answerCallbackQuery", data)
        except Exception as e:
            logger.warning("Failed to answer callback query: %s", e)

    async def _set_model(self, chat_id: int, model_id: str) -> None:
        """Persist selected model in plugin_data."""
        conn = await self._get_db_conn()
        try:
            row = await conn.fetchrow(
                """SELECT id, data FROM plugin_data
                   WHERE plugin_name = $1 AND record_type = $2
                     AND data->>'telegram_chat_id' = $3""",
                PLUGIN_NAME,
                RECORD_TYPE_LINKED_ACCOUNT,
                str(chat_id),
            )

            if not row:
                logger.warning(
                    "Cannot set model: no linked account for chat_id=%d", chat_id
                )
                return

            # Update the data with selected model
            data = json.loads(row["data"])
            data["selected_model"] = model_id

            await conn.execute(
                "UPDATE plugin_data SET data = $1::jsonb, updated_at = NOW() WHERE id = $2",
                json.dumps(data),
                row["id"],
            )

            # Send confirmation message
            model_config = self._get_model_config(model_id)
            model_name = (
                model_config.get("name", model_id) if model_config else model_id
            )
            await self.send_message(
                chat_id,
                f"✅ <b>Model switched to:</b> {model_name}",
            )

            logger.info("Set model for telegram_chat_id=%d: %s", chat_id, model_id)
        finally:
            await conn.close()

    async def _show_provider_models(
        self, chat_id: int, query_id: str, provider: str
    ) -> None:
        """Show all models for a specific provider."""
        conn = await self._get_db_conn()
        try:
            row = await conn.fetchrow(
                """SELECT data FROM plugin_data
                   WHERE plugin_name = $1 AND record_type = $2
                     AND data->>'telegram_chat_id' = $3""",
                PLUGIN_NAME,
                RECORD_TYPE_LINKED_ACCOUNT,
                str(chat_id),
            )

            if not row:
                await self._answer_callback(query_id, "Error: Account not linked")
                return

            data = json.loads(row["data"])
            selected_model = data.get("selected_model", "")

            # Get models for this provider
            provider_models = [m for m in self._models if m.get("provider") == provider]

            if not provider_models:
                await self._answer_callback(query_id, f"No models found for {provider}")
                return

            # Build keyboard with models for this provider
            keyboard = []

            for model in provider_models:
                model_id = model.get("id", "")
                model_name = model.get("name", model_id)

                # Truncate long names
                if len(model_name) > 25:
                    model_name = model_name[:22] + "..."

                # Mark selected model
                prefix = "✅ " if model_id == selected_model else ""

                keyboard.append(
                    [
                        {
                            "text": f"{prefix}{model_name}",
                            "callback_data": f"model:{model_id}",
                        }
                    ]
                )

            # Add back button
            keyboard.append([{"text": "◀️ Back", "callback_data": "model:back"}])

            await self._answer_callback(query_id)

            await self._call_api(
                "sendMessage",
                {
                    "chat_id": chat_id,
                    "text": f"Models from {provider.upper()}:\n\nSelect a model:",
                    "reply_markup": {"inline_keyboard": keyboard},
                },
            )
        finally:
            await conn.close()

    async def get_messages(
        self, user_id: str, limit: int = 100
    ) -> list[Dict[str, Any]]:
        """Get Telegram messages for a user from plugin_data."""
        conn = await self._get_db_conn()
        try:
            rows = await conn.fetch(
                """SELECT id, data, created_at FROM plugin_data
                   WHERE plugin_name = $1 AND record_type = $2
                     AND user_id = $3::uuid
                   ORDER BY created_at ASC
                   LIMIT $4""",
                PLUGIN_NAME,
                RECORD_TYPE_MESSAGE,
                user_id,
                limit,
            )
            messages = []
            for r in rows:
                msg_data = json.loads(r["data"])
                messages.append({
                    "id": str(r["id"]),
                    "role": msg_data.get("role", "user"),
                    "text": msg_data.get("text", ""),
                    "created_at": r["created_at"].isoformat() if r["created_at"] else "",
                })
            return messages
        finally:
            await conn.close()

    async def save_assistant_message(
        self, user_id: str, telegram_chat_id: int, text: str
    ) -> None:
        """Save an assistant response message to plugin_data."""
        import uuid

        conn = await self._get_db_conn()
        try:
            await conn.execute(
                """INSERT INTO plugin_data (id, user_id, plugin_name, record_type, data, created_at, updated_at)
                   VALUES ($1, $2::uuid, $3, $4, $5::jsonb, NOW(), NOW())""",
                uuid.uuid4(),
                user_id,
                PLUGIN_NAME,
                RECORD_TYPE_MESSAGE,
                json.dumps({
                    "telegram_chat_id": telegram_chat_id,
                    "role": "assistant",
                    "text": text,
                }),
            )
        except Exception as e:
            logger.error("Failed to save assistant message to plugin_data: %s", e)
        finally:
            await conn.close()

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
