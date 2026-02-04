"""
GitHub tools for server-side plugin.
Provides repository, issue, and PR management functionality.
"""

import asyncio
import base64
import logging
from typing import Any, Dict, List, Optional, Union

from agno.tools import Toolkit

logger = logging.getLogger(__name__)


class GitHubTools(Toolkit):
    """GitHub integration tools for repository management."""

    def __init__(self, access_token: str, base_url: str = "https://api.github.com"):
        super().__init__(name="github_tools")
        self.access_token = access_token
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github.v3+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        self.register(self.list_repos)
        self.register(self.get_repo)
        self.register(self.list_issues)
        self.register(self.create_issue)
        self.register(self.list_pull_requests)
        self.register(self.get_file_content)
        self.register(self.create_or_update_file)

    async def _make_request(
        self, method: str, endpoint: str, data: Optional[Dict] = None
    ) -> Union[Dict[str, Any], List[Dict[str, Any]]]:
        """Make an authenticated request to GitHub API."""
        import aiohttp

        url = f"{self.base_url}/{endpoint.lstrip('/')}"

        async with aiohttp.ClientSession() as session:
            async with session.request(
                method, url, headers=self.headers, json=data
            ) as response:
                if response.status >= 400:
                    error_text = await response.text()
                    raise Exception(
                        f"GitHub API error: {response.status} - {error_text}"
                    )

                if response.status == 204:
                    return {}

                return await response.json()

    def list_repos(self, limit: int = 30) -> List[Dict[str, Any]]:
        """List user's GitHub repositories.

        Args:
            limit: Maximum number of repositories to return

        Returns:
            List of repository objects with name, full_name, description, etc.
        """

        async def _fetch():
            params = f"?per_page={limit}&sort=updated"
            result = await self._make_request("GET", f"/user/repos{params}")
            if isinstance(result, list):
                return result
            return []

        return asyncio.run(_fetch())

    def get_repo(self, owner: str, repo: str) -> Dict[str, Any]:
        """Get details of a specific repository.

        Args:
            owner: Repository owner (user or organization)
            repo: Repository name

        Returns:
            Repository details including description, stars, forks, etc.
        """

        async def _fetch():
            result = await self._make_request("GET", f"/repos/{owner}/{repo}")
            if isinstance(result, dict):
                return result
            return {}

        return asyncio.run(_fetch())

    def list_issues(
        self, owner: str, repo: str, state: str = "open", limit: int = 10
    ) -> List[Dict[str, Any]]:
        """List issues in a repository.

        Args:
            owner: Repository owner
            repo: Repository name
            state: Issue state (open, closed, all)
            limit: Maximum number of issues to return

        Returns:
            List of issue objects
        """

        async def _fetch():
            params = f"?state={state}&per_page={limit}"
            result = await self._make_request(
                "GET", f"/repos/{owner}/{repo}/issues{params}"
            )
            if isinstance(result, list):
                return result
            return []

        return asyncio.run(_fetch())

    def create_issue(
        self,
        owner: str,
        repo: str,
        title: str,
        body: Optional[str] = None,
        labels: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Create a new issue in a repository.

        Args:
            owner: Repository owner
            repo: Repository name
            title: Issue title
            body: Issue body/description
            labels: List of label names to apply

        Returns:
            Created issue object
        """

        async def _create():
            data: Dict[str, Any] = {"title": title}
            if body:
                data["body"] = body
            if labels:
                data["labels"] = labels
            result = await self._make_request(
                "POST", f"/repos/{owner}/{repo}/issues", data
            )
            if isinstance(result, dict):
                return result
            return {}

        return asyncio.run(_create())

    def list_pull_requests(
        self, owner: str, repo: str, state: str = "open", limit: int = 10
    ) -> List[Dict[str, Any]]:
        """List pull requests in a repository.

        Args:
            owner: Repository owner
            repo: Repository name
            state: PR state (open, closed, all)
            limit: Maximum number of PRs to return

        Returns:
            List of pull request objects
        """

        async def _fetch():
            params = f"?state={state}&per_page={limit}"
            result = await self._make_request(
                "GET", f"/repos/{owner}/{repo}/pulls{params}"
            )
            if isinstance(result, list):
                return result
            return []

        return asyncio.run(_fetch())

    def get_file_content(
        self, owner: str, repo: str, path: str, ref: str = "main"
    ) -> Dict[str, Any]:
        """Get content of a file in a repository.

        Args:
            owner: Repository owner
            repo: Repository name
            path: File path within the repository
            ref: Git reference (branch, tag, commit SHA)

        Returns:
            File content and metadata
        """

        async def _fetch():
            params = f"?ref={ref}"
            result = await self._make_request(
                "GET", f"/repos/{owner}/{repo}/contents/{path}{params}"
            )

            if not isinstance(result, dict):
                return {}

            # Decode base64 content if present
            if result.get("content"):
                try:
                    content = base64.b64decode(result["content"]).decode("utf-8")
                    result["decoded_content"] = content
                except Exception as e:
                    logger.warning(f"Failed to decode file content: {e}")

            return result

        return asyncio.run(_fetch())

    def create_or_update_file(
        self,
        owner: str,
        repo: str,
        path: str,
        content: str,
        message: str,
        branch: str = "main",
        sha: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create or update a file in a repository.

        Args:
            owner: Repository owner
            repo: Repository name
            path: File path within the repository
            content: File content (will be base64 encoded)
            message: Commit message
            branch: Branch to commit to
            sha: SHA of the file being replaced (required for updates)

        Returns:
            Commit information
        """

        async def _create_or_update():
            # Encode content to base64
            content_bytes = content.encode("utf-8")
            encoded_content = base64.b64encode(content_bytes).decode("utf-8")

            data: Dict[str, Any] = {
                "message": message,
                "content": encoded_content,
                "branch": branch,
            }

            if sha:
                data["sha"] = sha

            result = await self._make_request(
                "PUT", f"/repos/{owner}/{repo}/contents/{path}", data
            )
            if isinstance(result, dict):
                return result
            return {}

        return asyncio.run(_create_or_update())


def build(params: Dict[str, Any]) -> Toolkit:
    """Build GitHub tools from parameters.

    Expected params:
        - access_token: GitHub OAuth access token
        - base_url: Optional GitHub API base URL (for GitHub Enterprise)

    Args:
        params: Configuration parameters

    Returns:
        Configured GitHubTools instance
    """
    access_token = params.get("access_token") or params.get("github_access_token")
    if not access_token:
        raise ValueError("GitHub access_token is required")

    base_url = params.get("base_url", "https://api.github.com")

    logger.info("Building GitHub tools with access token")
    return GitHubTools(access_token=access_token, base_url=base_url)
