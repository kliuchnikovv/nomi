"""
FastAPI routes for the GitHub plugin.
Registered in the main app at startup via plugin loader.
"""

import logging
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request

from .cache import GitHubRepoCache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/plugins/github", tags=["github"])


async def _get_github_token(user_id: str) -> str:
    """Get GitHub access token from database for user."""
    import asyncpg
    import json

    db_dsn = os.getenv("DB_DSN", "")
    if db_dsn.startswith("postgres://"):
        db_dsn = db_dsn.replace("postgres://", "postgresql://", 1)

    conn = await asyncpg.connect(db_dsn)
    try:
        # Tokens are stored in the integrations table as JSON params
        row = await conn.fetchrow(
            """
            SELECT params
            FROM integrations
            WHERE user_id = $1 AND provider = 'github' AND enabled = true
            LIMIT 1
            """,
            user_id,
        )
        if not row:
            raise HTTPException(
                status_code=404,
                detail="GitHub integration not found for this user. Please connect your GitHub account.",
            )

        params = json.loads(row["params"])
        token = params.get("access_token")
        if not token:
            raise HTTPException(
                status_code=500,
                detail="GitHub access token missing in integration params",
            )
        return token
    finally:
        await conn.close()


async def _get_github_tools(user_id: str, access_token: Optional[str] = None):
    """Get GitHubTools instance for user.

    The Go API proxy decrypts the stored OAuth token and forwards it as the
    X-Provider-Token header (see ProxyPlugins). We use it when present and only
    fall back to a DB lookup otherwise.
    """
    from .tools import GitHubTools

    if not access_token:
        access_token = await _get_github_token(user_id)
    return GitHubTools(access_token=access_token)


# ─── Repositories (authenticated via X-User-ID) ────────────────


@router.get("/repos")
async def list_repos(
    request: Request, limit: int = 30, refresh: bool = False
) -> Dict[str, Any]:
    """List GitHub repositories for the authenticated user."""
    user_id = request.headers.get("X-User-ID")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        # Try to get cached repos if not forcing refresh
        if not refresh:
            cached = await GitHubRepoCache.get_cached_repos(user_id)
            if cached:
                logger.info("Returning cached repos for user %s", user_id)
                # Apply limit to cached repos
                repos = cached[:limit] if cached else []
                return {"repos": repos, "cached": True}

        # Fetch from GitHub API
        github_tool = await _get_github_tools(
            user_id, request.headers.get("X-Provider-Token")
        )
        repos = await github_tool.list_repos(limit=limit)

        # Update cache
        await GitHubRepoCache.set_cached_repos(user_id, repos)

        return {"repos": repos, "cached": False}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to fetch GitHub repos for user %s: %s", user_id, e, exc_info=True
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/repos/{owner}/{repo}")
async def get_repo(request: Request, owner: str, repo: str) -> Dict[str, Any]:
    """Get details of a specific repository."""
    user_id = request.headers.get("X-User-ID")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        github_tool = await _get_github_tools(
            user_id, request.headers.get("X-Provider-Token")
        )
        repo_data = await github_tool.get_repo(owner=owner, repo=repo)
        return repo_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to fetch GitHub repo %s/%s: %s", owner, repo, e, exc_info=True
        )
        raise HTTPException(status_code=500, detail=str(e))


# ─── Issues (authenticated via X-User-ID) ─────────────────────


@router.get("/repos/{owner}/{repo}/issues")
async def list_issues(
    request: Request,
    owner: str,
    repo: str,
    state: str = "open",
    limit: int = 10,
) -> Dict[str, Any]:
    """List issues in a repository."""
    user_id = request.headers.get("X-User-ID")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    if state not in ("open", "closed", "all"):
        raise HTTPException(
            status_code=400, detail="Invalid state. Must be open, closed, or all"
        )

    try:
        github_tool = await _get_github_tools(
            user_id, request.headers.get("X-Provider-Token")
        )
        issues = await github_tool.list_issues(
            owner=owner, repo=repo, state=state, limit=limit
        )
        return {"issues": issues}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to fetch GitHub issues for %s/%s: %s", owner, repo, e, exc_info=True
        )
        raise HTTPException(status_code=500, detail=str(e))


# ─── Pull Requests (authenticated via X-User-ID) ──────────────


@router.get("/repos/{owner}/{repo}/pulls")
async def list_pull_requests(
    request: Request,
    owner: str,
    repo: str,
    state: str = "open",
    limit: int = 10,
) -> Dict[str, Any]:
    """List pull requests in a repository."""
    user_id = request.headers.get("X-User-ID")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    if state not in ("open", "closed", "all"):
        raise HTTPException(
            status_code=400, detail="Invalid state. Must be open, closed, or all"
        )

    try:
        github_tool = await _get_github_tools(
            user_id, request.headers.get("X-Provider-Token")
        )
        pulls = await github_tool.list_pull_requests(
            owner=owner, repo=repo, state=state, limit=limit
        )
        return {"pulls": pulls}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to fetch GitHub PRs for %s/%s: %s", owner, repo, e, exc_info=True
        )
        raise HTTPException(status_code=500, detail=str(e))


# ─── File Content (authenticated via X-User-ID) ─────────────────


@router.get("/repos/{owner}/{repo}/contents/{path:path}")
async def get_file_content(
    request: Request,
    owner: str,
    repo: str,
    path: str,
    ref: str = "main",
) -> Dict[str, Any]:
    """Get content of a file in a repository."""
    user_id = request.headers.get("X-User-ID")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        github_tool = await _get_github_tools(
            user_id, request.headers.get("X-Provider-Token")
        )
        file_data = await github_tool.get_file_content(
            owner=owner, repo=repo, path=path, ref=ref
        )
        return file_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to fetch GitHub file content for %s/%s/%s: %s",
            owner,
            repo,
            path,
            e,
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=str(e))
