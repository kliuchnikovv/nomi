"""
GitHub tools for server-side plugin.
Provides repository, issue, and PR management functionality.
"""

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
        self.register(self.list_commits)
        self.register(self.list_issues)
        self.register(self.create_issue)
        self.register(self.list_pull_requests)
        self.register(self.get_file_content)
        self.register(self.create_or_update_file)
        self.register(self.create_branch)
        self.register(self.create_pull_request)

    async def _resolve_repo(
        self, owner: Optional[str], repo: str
    ) -> tuple[str, str]:
        """Resolve (owner, repo), tolerating a missing or wrong owner.

        With a GitHub App installation token the agent usually knows only the
        repo name and guesses the owner, causing 404s. Look the repo up among
        the installation's accessible repositories by name and use the
        authoritative owner. Falls back to the provided owner when the repo
        isn't found in the listing (e.g. legacy OAuth tokens).
        """
        # Accept "owner/repo" passed as the repo argument.
        if repo and "/" in repo:
            first, repo = repo.split("/", 1)
            owner = owner or first

        target = repo.lower()
        try:
            for r in await self.list_repos(limit=100):
                if not isinstance(r, dict) or r.get("name", "").lower() != target:
                    continue
                full = r.get("full_name") or ""
                resolved_owner = (
                    full.split("/", 1)[0]
                    if "/" in full
                    else (r.get("owner") or {}).get("login", "")
                )
                if resolved_owner:
                    return resolved_owner, r.get("name", repo)
        except Exception as e:
            logger.warning("Repo resolution lookup failed for '%s': %s", repo, e)

        if not owner:
            raise Exception(
                f"Could not resolve owner for repository '{repo}'. "
                "Call list_repos to find the exact owner."
            )
        return owner, repo

    async def _get_default_branch(self, owner: str, repo: str) -> str:
        """Return the repository's default branch (best-effort, defaults to main)."""
        info = await self._make_request("GET", f"/repos/{owner}/{repo}")
        if isinstance(info, dict):
            return info.get("default_branch") or "main"
        return "main"

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

    async def list_repos(self, limit: int = 30) -> List[Dict[str, Any]]:
        """List user's GitHub repositories.

        Args:
            limit: Maximum number of repositories to return

        Returns:
            List of repository objects with name, full_name, description, etc.
        """
        # With a GitHub App installation token, list only the repositories the
        # user granted to the installation (excludes org repos the App isn't on).
        try:
            result = await self._make_request(
                "GET", f"/installation/repositories?per_page={limit}"
            )
            if isinstance(result, dict) and "repositories" in result:
                return result.get("repositories", [])
        except Exception:
            # Not an installation token (e.g. legacy OAuth) — fall back below.
            pass

        result = await self._make_request(
            "GET", f"/user/repos?per_page={limit}&sort=updated"
        )
        if isinstance(result, list):
            return result
        return []

    async def get_repo(self, owner: str, repo: str) -> Dict[str, Any]:
        """Get details of a specific repository.

        Args:
            owner: Repository owner (user or organization)
            repo: Repository name

        Returns:
            Repository details including description, stars, forks, etc.
        """
        result = await self._make_request("GET", f"/repos/{owner}/{repo}")
        if isinstance(result, dict):
            return result
        return {}

    async def list_commits(
        self,
        repo: str,
        owner: Optional[str] = None,
        sha: Optional[str] = None,
        path: Optional[str] = None,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """List commits in a repository, most recent first.

        Args:
            repo: Repository name (may be given as "owner/repo")
            owner: Repository owner; resolved automatically from your
                accessible repositories when omitted or incorrect
            sha: Branch, tag, or commit SHA to start listing from
                (defaults to the repository's default branch)
            path: Only list commits that touch this file path
            limit: Maximum number of commits to return

        Returns:
            List of commit objects (sha, commit.message, commit.author, etc.)
        """
        owner, repo = await self._resolve_repo(owner, repo)
        query = f"?per_page={limit}"
        if sha:
            query += f"&sha={sha}"
        if path:
            query += f"&path={path}"
        result = await self._make_request(
            "GET", f"/repos/{owner}/{repo}/commits{query}"
        )
        if isinstance(result, list):
            return result
        return []

    async def list_issues(
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
        params = f"?state={state}&per_page={limit}"
        result = await self._make_request(
            "GET", f"/repos/{owner}/{repo}/issues{params}"
        )
        if isinstance(result, list):
            return result
        return []

    async def create_issue(
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
        data: Dict[str, Any] = {"title": title}
        if body:
            data["body"] = body
        if labels:
            data["labels"] = labels
        result = await self._make_request("POST", f"/repos/{owner}/{repo}/issues", data)
        if isinstance(result, dict):
            return result
        return {}

    async def list_pull_requests(
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
        params = f"?state={state}&per_page={limit}"
        result = await self._make_request("GET", f"/repos/{owner}/{repo}/pulls{params}")
        if isinstance(result, list):
            return result
        return []

    async def get_file_content(
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

    async def create_or_update_file(
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
        owner, repo = await self._resolve_repo(owner, repo)
        # Guard: never commit directly to the default branch or master/main.
        # The agent must work on a feature branch and open a pull request.
        default_branch = await self._get_default_branch(owner, repo)
        if branch == default_branch or branch.lower() in ("main", "master"):
            raise ValueError(
                f"Refusing to commit directly to '{branch}'. Create a feature "
                "branch (create_branch) and open a pull request (create_pull_request)."
            )

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

    async def create_branch(
        self,
        owner: str,
        repo: str,
        branch: str,
        from_branch: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a new branch from another branch.

        Args:
            owner: Repository owner
            repo: Repository name
            branch: Name of the new branch
            from_branch: Base branch to branch from (defaults to the default branch)

        Returns:
            The created git ref
        """
        owner, repo = await self._resolve_repo(owner, repo)
        base = from_branch or await self._get_default_branch(owner, repo)
        ref = await self._make_request(
            "GET", f"/repos/{owner}/{repo}/git/ref/heads/{base}"
        )
        sha = None
        if isinstance(ref, dict):
            sha = ref.get("object", {}).get("sha")
        if not sha:
            raise Exception(f"Could not resolve base branch '{base}'")

        result = await self._make_request(
            "POST",
            f"/repos/{owner}/{repo}/git/refs",
            {"ref": f"refs/heads/{branch}", "sha": sha},
        )
        return result if isinstance(result, dict) else {}

    async def create_pull_request(
        self,
        owner: str,
        repo: str,
        title: str,
        head: str,
        base: Optional[str] = None,
        body: str = "",
    ) -> Dict[str, Any]:
        """Open a pull request from a head branch into a base branch.

        Args:
            owner: Repository owner
            repo: Repository name
            title: Pull request title
            head: Branch with your changes
            base: Target branch (defaults to the repo's default branch)
            body: Pull request description

        Returns:
            The created pull request
        """
        owner, repo = await self._resolve_repo(owner, repo)
        target = base or await self._get_default_branch(owner, repo)
        if head == target:
            raise ValueError("head and base must be different branches")

        result = await self._make_request(
            "POST",
            f"/repos/{owner}/{repo}/pulls",
            {"title": title, "head": head, "base": target, "body": body},
        )
        return result if isinstance(result, dict) else {}


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
