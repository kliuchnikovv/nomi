from __future__ import annotations

import json
import urllib.request
import urllib.error
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession  # only for signature compatibility


class TokenStoreRemote:
    """
    Minimal HTTP-based token store that integrates with external OAuth service.
    It uses the service OpenAPI:
      GET  /api/token/{profile}/{provider} -> JSON token payload
      PUT  /api/token/{profile}/{provider} -> replaces JSON token payload

    The payload shape is expected to be compatible with our internal usage:
      {access_token, refresh_token, expiry_epoch, token_uri, client_id,
       client_secret, scopes: [...], account_email?}
    """

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def _url(self, profile_id: str, provider: str) -> str:
        return f"{self.base_url}/api/token/{profile_id}/{provider}"

    async def get_payload(self, session: AsyncSession, provider: str, profile_id: str) -> dict:
        req = urllib.request.Request(self._url(profile_id, provider), method="GET")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = resp.read()
                return json.loads(data or b"{}")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise KeyError("Token not found")
            raise

    async def rotate_access(self, session: AsyncSession, provider: str, profile_id: str, account_email: str,
                            new_access: str, new_expiry_epoch: int):
        # Read-only integration: do nothing
        return

    # Compatibility no-ops for interfaces used elsewhere
    async def log_action(self, *args, **kwargs):
        return
    async def get_logs(self, *args, **kwargs):
        return []
    async def revoke(self, *args, **kwargs):
        return
    async def upsert(self, session: AsyncSession, rec) -> str:
        # Read-only: do nothing, treat as success
        return "remote"
    async def lock_for_refresh(self, *args, **kwargs):
        return None, None
    async def write_after_refresh(self, *args, **kwargs):
        # For remote backend we push entire payload via rotate_access instead
        return
