"""
FastAPI routes for the Telegram plugin.
Registered in the main app at startup via plugin loader.
"""

import logging
from typing import Dict, Any

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from plugins.telegram.server.service import get_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/plugins/telegram", tags=["telegram"])


# ─── Webhook (public, no auth) ───────────────────────

@router.post("/webhook")
async def webhook(request: Request) -> Dict[str, Any]:
    """Handle incoming Telegram webhook updates.
    This endpoint is called by Telegram servers.
    """
    service = get_service()
    if not service.enabled:
        raise HTTPException(status_code=503, detail="Telegram integration not configured")

    try:
        update = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    # Process asynchronously — return 200 immediately
    import asyncio
    asyncio.create_task(_process_webhook(service, update))

    return {"ok": True}


async def _process_webhook(service, update: Dict[str, Any]) -> None:
    """Process webhook update in background."""
    try:
        await service.handle_webhook(update)
    except Exception as e:
        logger.error("Failed to process telegram webhook: %s", e, exc_info=True)


# ─── Link with code (authenticated via X-User-ID) ────

class LinkRequest(BaseModel):
    code: str


@router.post("/link")
async def link_with_code(request: Request, body: LinkRequest) -> Dict[str, Any]:
    """Validate a 6-digit code from the Telegram bot and link the account.
    User ID is passed via X-User-ID header from Go API proxy.
    """
    user_id = request.headers.get("X-User-ID")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    service = get_service()
    if not service.enabled:
        raise HTTPException(status_code=503, detail="Telegram integration not configured")

    # Validate the code
    info = await service.validate_link_code(body.code)
    if not info:
        raise HTTPException(status_code=400, detail="Invalid or expired code. Please send /start to the bot again.")

    # Link the accounts
    await service.link_user(
        user_id=user_id,
        telegram_chat_id=info["telegram_chat_id"],
        telegram_user_id=info["telegram_user_id"],
        username=info["username"],
        first_name=info["first_name"],
    )

    # Notify the user in Telegram
    try:
        await service.send_message(
            info["telegram_chat_id"],
            "Account linked successfully! 🎉\n\nYou can now send messages here and I'll respond with AI-powered answers.",
        )
    except Exception as e:
        logger.warning("Failed to send link confirmation to Telegram: %s", e)

    display_name = f"@{info['username']}" if info.get("username") else info.get("first_name", "")
    return {
        "ok": True,
        "username": info.get("username", ""),
        "first_name": info.get("first_name", ""),
        "display_name": display_name,
        "telegram_chat_id": info["telegram_chat_id"],
    }


# ─── Status check (authenticated via X-User-ID) ─────

@router.get("/status")
async def get_status(request: Request) -> Dict[str, Any]:
    """Check if the authenticated user has a linked Telegram account."""
    user_id = request.headers.get("X-User-ID")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    service = get_service()
    return await service.get_link_status(user_id)
