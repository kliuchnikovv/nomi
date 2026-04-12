"""
FastAPI routes for the Sandbox plugin.
Registered in the main app at startup via plugin loader.
"""

import logging
from typing import Dict, Any

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from plugins.sandbox.server.service import get_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/plugins/sandbox", tags=["sandbox"])


# ─── Create Sandbox ──────────────────────────────────


class CreateSandboxRequest(BaseModel):
    project_id: str = ""


@router.post("/create")
async def create_sandbox(
    request: Request, body: CreateSandboxRequest
) -> Dict[str, Any]:
    """Create a new sandbox for the authenticated user."""
    user_id = request.headers.get("X-User-ID")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    service = get_service()

    try:
        sandbox_id = await service.get_or_create_sandbox(user_id, body.project_id)
        return {"ok": True, "sandbox_id": sandbox_id}
    except Exception as e:
        logger.error(f"Failed to create sandbox: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Get Sandbox Status ──────────────────────────────


@router.get("/status")
async def get_sandbox_status(request: Request) -> Dict[str, Any]:
    """Get the status of the user's sandbox."""
    user_id = request.headers.get("X-User-ID")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    service = get_service()

    # Get sandbox ID from cache
    sandbox_id = service.get_cached_sandbox_id(user_id)
    if not sandbox_id:
        raise HTTPException(status_code=404, detail="No sandbox found")

    status = await service.get_sandbox_status(sandbox_id)
    if not status:
        raise HTTPException(status_code=404, detail="Sandbox not found")

    return status


# ─── Destroy Sandbox ─────────────────────────────────


@router.post("/destroy")
async def destroy_sandbox(request: Request, delete_pvc: bool = False) -> Dict[str, Any]:
    """Destroy the user's sandbox."""
    user_id = request.headers.get("X-User-ID")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    service = get_service()

    sandbox_id = service.get_cached_sandbox_id(user_id)
    if not sandbox_id:
        raise HTTPException(status_code=404, detail="No sandbox found")

    try:
        await service.destroy_sandbox(sandbox_id, delete_pvc)
        return {"ok": True}
    except Exception as e:
        logger.error(f"Failed to destroy sandbox: {e}")
        raise HTTPException(status_code=500, detail=str(e))
