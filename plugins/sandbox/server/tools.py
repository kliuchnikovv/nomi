"""
Sandbox tools for server-side plugin.
Provides isolated Linux environment for code execution.
"""

import base64
import logging
import re
from typing import Any, Dict, List, Optional

from agno.tools import Toolkit

from plugins.sandbox.server.service import SandboxNotFoundError, get_service

logger = logging.getLogger(__name__)

# Safe characters for values embedded in a git command. owner/repo/dest are a
# single path segment (no slash); ref (branch/tag/commit) may contain slashes.
_GIT_SAFE = re.compile(r"^[A-Za-z0-9._-]+$")
_GIT_SAFE_REF = re.compile(r"^[A-Za-z0-9._/-]+$")


def _check_git_arg(label: str, value: str, *, allow_slash: bool = False) -> None:
    """Reject values that are unsafe to pass to git as an argument.

    Guards against argv flag smuggling (a leading '-' makes git read the value
    as an option) and path traversal ('..').
    """
    pattern = _GIT_SAFE_REF if allow_slash else _GIT_SAFE
    if not value or value.startswith("-") or ".." in value or not pattern.match(value):
        raise ValueError(f"Invalid {label}: {value!r}")


class SandboxTools(Toolkit):
    """Sandbox tools for executing commands in isolated Linux environment."""

    def __init__(
        self, user_id: str, project_id: str = "", github_token: str = ""
    ):
        super().__init__(name="sandbox_tools")
        self.user_id = user_id
        self.project_id = project_id
        # Server-side only: used to authenticate `clone_repo` for private repos.
        # Never exposed to the model.
        self.github_token = github_token
        self._sandbox_id: Optional[str] = None
        self._service = get_service()

        self.register(self.exec_command)
        self.register(self.upload_file)
        self.register(self.download_file)
        self.register(self.list_files)
        self.register(self.clone_repo)

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
        """Execute a shell command in an isolated Linux sandbox.

        Use this when no dedicated tool fits the task. The working directory is
        /workspace and persists between calls. Preinstalled: python3, pip, node,
        npm, git, curl, build-essential. Internet access is available, so you can
        install extra packages (pip install, npm install, apt is not available as
        non-root). A non-zero exit_code means the command failed; exit_code 124
        means it timed out.

        Args:
            command: Command and arguments as a list (e.g., ["python3", "script.py"])
            timeout: Timeout in seconds (default 60)
            working_dir: Working directory (default /workspace)

        Returns:
            Dict with stdout, stderr, and exit_code
        """
        if working_dir:
            # Sanitize working_dir to prevent shell injection
            if not re.match(r'^[a-zA-Z0-9_./-]+$', working_dir):
                raise ValueError(f"Invalid working_dir: {working_dir!r}")
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

    async def clone_repo(
        self,
        owner: str,
        repo: str,
        ref: Optional[str] = None,
        dest: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Clone a GitHub repository into the sandbox workspace.

        Works for public repos always, and for the user's private repos when a
        GitHub integration is connected (authentication is handled server-side —
        you don't need a token). After cloning, the repo is at ./<dest> in
        /workspace and you can run commands in it with exec_command.

        Args:
            owner: Repository owner (user or organization)
            repo: Repository name
            ref: Optional branch, tag, or commit to check out after cloning
            dest: Optional destination directory name (defaults to the repo name)

        Returns:
            Dict with stdout, stderr, and exit_code
        """
        _check_git_arg("owner", owner)
        _check_git_arg("repo", repo)
        target = dest or repo
        _check_git_arg("dest", target)
        if ref is not None:
            _check_git_arg("ref", ref, allow_slash=True)

        url = f"https://github.com/{owner}/{repo}.git"
        command = ["git"]
        if self.github_token:
            # Pass credentials via a per-invocation header so the token is NOT
            # persisted into the cloned repo's .git/config or `git remote -v`.
            auth = base64.b64encode(
                f"x-access-token:{self.github_token}".encode()
            ).decode()
            command += ["-c", f"http.extraHeader=Authorization: Basic {auth}"]
        # "--" terminates option parsing so url/target can't be read as flags.
        command += ["clone", "--", url, target]

        result = await self._exec_with_retry(command, timeout=300)

        # Check out a specific ref if requested and the clone succeeded.
        if ref and isinstance(result, dict) and result.get("exit_code") == 0:
            # "--end-of-options" stops flag parsing while keeping ref's revision
            # semantics (a plain "--" would make git treat ref as a pathspec).
            checkout = await self._exec_with_retry(
                ["git", "-C", target, "checkout", "--end-of-options", ref],
                timeout=60,
            )
            if checkout.get("exit_code") != 0:
                return checkout
        return result


def build(params: Dict[str, Any]) -> Toolkit:
    """Build Sandbox tools from parameters.

    Expected params:
        - user_id: User ID (required)
        - project_id: Project ID (optional)
        - github_token: GitHub access token for clone_repo (optional)

    Args:
        params: Configuration parameters

    Returns:
        Configured SandboxTools instance
    """
    user_id = params.get("user_id")
    if not user_id:
        raise ValueError("user_id is required for Sandbox tools")

    project_id = params.get("project_id", "")
    github_token = params.get("github_token", "")

    logger.info(f"Building Sandbox tools for user {user_id}")
    return SandboxTools(
        user_id=user_id, project_id=project_id, github_token=github_token
    )
