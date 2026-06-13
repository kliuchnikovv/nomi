"""
Sandbox service singleton for HTTP client to controller.
"""

import asyncio
import logging
import os
from typing import Any, Dict, Optional

import aiohttp

logger = logging.getLogger(__name__)

SANDBOX_CONTROLLER_URL = os.getenv(
    "SANDBOX_CONTROLLER_URL", "http://sandbox-sidecar:8090"
)
SANDBOX_CONTROLLER_TOKEN = os.getenv("SANDBOX_CONTROLLER_TOKEN", "")


class SandboxService:
    """Service for interacting with the sandbox controller."""

    def __init__(self):
        url = SANDBOX_CONTROLLER_URL.rstrip("/")
        if not url.startswith(("http://", "https://")):
            url = f"http://{url}"
        self.base_url = url
        self.token = SANDBOX_CONTROLLER_TOKEN
        self._sandbox_cache: Dict[str, str] = {}  # user_id -> sandbox_id

    def _get_headers(self) -> Dict[str, str]:
        """Get request headers with authentication."""
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["X-Controller-Token"] = self.token
        return headers

    async def get_or_create_sandbox(self, user_id: str, project_id: str = "") -> str:
        """Get existing sandbox or create new one for user."""
        cache_key = f"{user_id}:{project_id}"

        # Check cache first
        if cache_key in self._sandbox_cache:
            sandbox_id = self._sandbox_cache[cache_key]
            # Verify it still exists
            status = await self.get_sandbox_status(sandbox_id)
            if status:
                return sandbox_id
            # Sandbox was deleted, remove from cache
            del self._sandbox_cache[cache_key]

        # Create new sandbox. Retry transient connection errors with backoff —
        # the controller may briefly reset connections under load or while starting.
        url = f"{self.base_url}/api/sandboxes"
        payload = {"user_id": user_id, "project_id": project_id}
        timeout = aiohttp.ClientTimeout(total=30)
        max_attempts = 3
        last_error: Optional[Exception] = None

        for attempt in range(1, max_attempts + 1):
            try:
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.post(
                        url, json=payload, headers=self._get_headers()
                    ) as response:
                        if response.status == 201:
                            data = await response.json()
                            sandbox_id = data["id"]
                            self._sandbox_cache[cache_key] = sandbox_id
                            logger.info(
                                f"Created sandbox {sandbox_id} for user {user_id}"
                            )
                            return sandbox_id
                        # Non-2xx is a controller-side error, not transient — fail fast.
                        error_text = await response.text()
                        raise Exception(f"Failed to create sandbox: {error_text}")
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                last_error = e
                logger.warning(
                    "Sandbox create attempt %d/%d failed: %s",
                    attempt,
                    max_attempts,
                    type(e).__name__,
                )
                if attempt < max_attempts:
                    await asyncio.sleep(0.5 * attempt)

        raise Exception(
            f"Sandbox is currently unavailable. Please try again later. "
            f"(Connection error: {type(last_error).__name__})"
        )

    async def get_sandbox_status(self, sandbox_id: str) -> Optional[Dict[str, Any]]:
        """Get sandbox status."""
        async with aiohttp.ClientSession() as session:
            url = f"{self.base_url}/api/sandboxes/{sandbox_id}"

            try:
                async with session.get(url, headers=self._get_headers()) as response:
                    if response.status == 200:
                        return await response.json()
                    elif response.status == 404:
                        return None
                    else:
                        error_text = await response.text()
                        logger.warning(f"Failed to get sandbox status: {error_text}")
                        return None
            except Exception as e:
                logger.warning(f"Error getting sandbox status: {e}")
                return None

    async def exec_command(
        self, sandbox_id: str, command: list, timeout: int = 60, stream: bool = False
    ) -> Dict[str, Any]:
        """Execute a command in the sandbox."""
        async with aiohttp.ClientSession() as session:
            url = f"{self.base_url}/api/sandboxes/{sandbox_id}/exec"
            payload = {"command": command, "timeout": timeout, "stream": stream}

            try:
                async with session.post(
                    url, json=payload, headers=self._get_headers()
                ) as response:
                    if response.status == 200:
                        return await response.json()
                    elif response.status == 404:
                        # Sandbox was GC'd, need to recreate
                        logger.warning(
                            f"Sandbox {sandbox_id} not found, needs recreation"
                        )
                        raise SandboxNotFoundError(f"Sandbox {sandbox_id} not found")
                    else:
                        error_text = await response.text()
                        raise Exception(f"Failed to execute command: {error_text}")
            except aiohttp.ClientError as e:
                raise Exception(f"Sandbox is currently unavailable. Please try again later. (Connection error: {type(e).__name__})")

    async def exec_stream(
        self, sandbox_id: str, command: list, timeout: int = 60
    ):
        """Execute a command with streaming output.

        Returns a tuple of (stream_reader, cleanup_coro).
        The caller MUST await cleanup_coro after consuming the stream to close the session.
        """
        session = aiohttp.ClientSession()
        url = f"{self.base_url}/api/sandboxes/{sandbox_id}/exec"
        payload = {"command": command, "timeout": timeout, "stream": True}

        try:
            response = await session.post(
                url, json=payload, headers=self._get_headers()
            )
            if response.status == 200:

                async def _cleanup():
                    await session.close()

                return response.content, _cleanup
            elif response.status == 404:
                await session.close()
                raise SandboxNotFoundError(f"Sandbox {sandbox_id} not found")
            else:
                error_text = await response.text()
                await session.close()
                raise Exception(f"Failed to execute command: {error_text}")
        except Exception:
            await session.close()
            raise

    async def upload_file(self, sandbox_id: str, path: str, content: str) -> bool:
        """Upload a file to the sandbox."""
        async with aiohttp.ClientSession() as session:
            url = f"{self.base_url}/api/sandboxes/{sandbox_id}/upload"
            payload = {"path": path, "content": content}

            try:
                async with session.post(
                    url, json=payload, headers=self._get_headers()
                ) as response:
                    if response.status == 200:
                        return True
                    elif response.status == 404:
                        raise SandboxNotFoundError(f"Sandbox {sandbox_id} not found")
                    else:
                        error_text = await response.text()
                        raise Exception(f"Failed to upload file: {error_text}")
            except aiohttp.ClientError as e:
                raise Exception(f"Sandbox is currently unavailable. Please try again later. (Connection error: {type(e).__name__})")

    async def download_file(self, sandbox_id: str, path: str) -> str:
        """Download a file from the sandbox."""
        async with aiohttp.ClientSession() as session:
            url = f"{self.base_url}/api/sandboxes/{sandbox_id}/download"

            try:
                async with session.get(
                    url, params={"path": path}, headers=self._get_headers()
                ) as response:
                    if response.status == 200:
                        return await response.text()
                    elif response.status == 404:
                        raise SandboxNotFoundError(f"Sandbox {sandbox_id} not found")
                    else:
                        error_text = await response.text()
                        raise Exception(f"Failed to download file: {error_text}")
            except aiohttp.ClientError as e:
                raise Exception(f"Sandbox is currently unavailable. Please try again later. (Connection error: {type(e).__name__})")

    async def list_files(self, sandbox_id: str, path: str = "/workspace") -> list:
        """List files in a directory."""
        async with aiohttp.ClientSession() as session:
            url = f"{self.base_url}/api/sandboxes/{sandbox_id}/files"

            try:
                async with session.get(
                    url, params={"path": path}, headers=self._get_headers()
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        return data.get("files", [])
                    elif response.status == 404:
                        raise SandboxNotFoundError(f"Sandbox {sandbox_id} not found")
                    else:
                        error_text = await response.text()
                        raise Exception(f"Failed to list files: {error_text}")
            except aiohttp.ClientError as e:
                raise Exception(f"Sandbox is currently unavailable. Please try again later. (Connection error: {type(e).__name__})")

    async def destroy_sandbox(self, sandbox_id: str, delete_pvc: bool = False) -> bool:
        """Destroy a sandbox."""
        async with aiohttp.ClientSession() as session:
            url = f"{self.base_url}/api/sandboxes/{sandbox_id}"
            params = {"delete_pvc": "true"} if delete_pvc else {}

            try:
                async with session.delete(
                    url, params=params, headers=self._get_headers()
                ) as response:
                    if response.status == 200:
                        # Remove from cache
                        for key, sid in list(self._sandbox_cache.items()):
                            if sid == sandbox_id:
                                del self._sandbox_cache[key]
                        return True
                    else:
                        error_text = await response.text()
                        raise Exception(f"Failed to destroy sandbox: {error_text}")
            except aiohttp.ClientError as e:
                raise Exception(f"Sandbox is currently unavailable. Please try again later. (Connection error: {type(e).__name__})")

    def clear_cache_for_user(self, user_id: str, project_id: str = ""):
        """Clear cache entry for a user."""
        cache_key = f"{user_id}:{project_id}"
        if cache_key in self._sandbox_cache:
            del self._sandbox_cache[cache_key]

    def get_cached_sandbox_id(self, user_id: str, project_id: str = "") -> Optional[str]:
        """Get the cached sandbox ID for a user, or None if not cached."""
        cache_key = f"{user_id}:{project_id}"
        return self._sandbox_cache.get(cache_key)


class SandboxNotFoundError(Exception):
    """Raised when a sandbox is not found (may have been GC'd)."""

    pass


# Singleton instance
_service: Optional[SandboxService] = None


def get_service() -> SandboxService:
    """Get or create the sandbox service singleton."""
    global _service
    if _service is None:
        _service = SandboxService()
    return _service
