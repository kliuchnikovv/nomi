"""
Sandbox tools for server-side plugin.
Provides isolated Linux environment for code execution.
"""

import logging
from typing import Any, Dict, List, Optional

from agno.tools import Toolkit

from plugins.sandbox.server.service import SandboxNotFoundError, get_service

logger = logging.getLogger(__name__)


class SandboxTools(Toolkit):
    """Sandbox tools for executing commands in isolated Linux environment."""

    def __init__(self, user_id: str, project_id: str = ""):
        super().__init__(name="sandbox_tools")
        self.user_id = user_id
        self.project_id = project_id
        self._sandbox_id: Optional[str] = None
        self._service = get_service()

        self.register(self.exec_command)
        self.register(self.upload_file)
        self.register(self.download_file)
        self.register(self.list_files)

    async def _get_sandbox(self) -> str:
        """Get or create sandbox for this user."""
        if self._sandbox_id is None:
            self._sandbox_id = await self._service.get_or_create_sandbox(
                self.user_id, self.project_id
            )
        return self._sandbox_id

    async def _exec_with_retry(
        self, command: List[str], timeout: int = 60, stream: bool = False
    ) -> Dict[str, Any]:
        """Execute command with automatic retry on sandbox recreation."""
        try:
            sandbox_id = await self._get_sandbox()
            return await self._service.exec_command(
                sandbox_id, command, timeout, stream
            )
        except SandboxNotFoundError:
            # Sandbox was GC'd, clear cache and retry once
            logger.info("Sandbox was GC'd, recreating...")
            self._service.clear_cache_for_user(self.user_id, self.project_id)
            self._sandbox_id = None
            sandbox_id = await self._get_sandbox()
            return await self._service.exec_command(
                sandbox_id, command, timeout, stream
            )

    async def exec_command(
        self,
        command: List[str],
        timeout: int = 60,
        working_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Execute a shell command in the sandbox.

        Args:
            command: Command and arguments as a list (e.g., ["ls", "-la"])
            timeout: Timeout in seconds (default 60)
            working_dir: Working directory (default /workspace)

        Returns:
            Dict with stdout, stderr, and exit_code
        """
        if working_dir:
            # Change to working directory first
            command = ["sh", "-c", f"cd {working_dir} && {' '.join(command)}"]

        result = await self._exec_with_retry(command, timeout)
        return result

    async def upload_file(self, path: str, content: str) -> bool:
        """Upload a file to the sandbox.

        Args:
            path: Path where to save the file (relative to /workspace or absolute)
            content: File content as string

        Returns:
            True if successful
        """
        sandbox_id = await self._get_sandbox()
        return await self._service.upload_file(sandbox_id, path, content)

    async def download_file(self, path: str) -> str:
        """Download a file from the sandbox.

        Args:
            path: Path to the file (relative to /workspace or absolute)

        Returns:
            File content as string
        """
        sandbox_id = await self._get_sandbox()
        return await self._service.download_file(sandbox_id, path)

    async def list_files(self, path: str = "/workspace") -> List[Dict[str, Any]]:
        """List files in a directory.

        Args:
            path: Directory path (default /workspace)

        Returns:
            List of file info dictionaries
        """
        sandbox_id = await self._get_sandbox()
        return await self._service.list_files(sandbox_id, path)


def build(params: Dict[str, Any]) -> Toolkit:
    """Build Sandbox tools from parameters.

    Expected params:
        - user_id: User ID (required)
        - project_id: Project ID (optional)

    Args:
        params: Configuration parameters

    Returns:
        Configured SandboxTools instance
    """
    user_id = params.get("user_id")
    if not user_id:
        raise ValueError("user_id is required for Sandbox tools")

    project_id = params.get("project_id", "")

    logger.info(f"Building Sandbox tools for user {user_id}")
    return SandboxTools(user_id=user_id, project_id=project_id)
