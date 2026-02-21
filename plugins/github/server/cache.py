"""
GitHub repository cache service for server-side plugin.
Stores and retrieves cached repository data in plugin_data table.
"""

import asyncpg
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class GitHubRepoCache:
    """Cache for GitHub repository data."""

    CACHE_TTL = timedelta(minutes=15)  # Cache expires after 15 minutes

    @staticmethod
    async def get_db_connection():
        """Get database connection."""
        db_dsn = os.getenv("DB_DSN", "")
        if db_dsn.startswith("postgres://"):
            db_dsn = db_dsn.replace("postgres://", "postgresql://", 1)
        return await asyncpg.connect(db_dsn)

    @staticmethod
    async def get_cached_repos(user_id: str) -> Optional[List[Dict[str, Any]]]:
        """Get cached repositories for user.

        Args:
            user_id: User ID

        Returns:
            Cached repositories or None if cache is stale/missing
        """
        conn = await GitHubRepoCache.get_db_connection()
        try:
            # Check if user has a cache record
            row = await conn.fetchrow(
                """
                SELECT data, created_at
                FROM plugin_data
                WHERE plugin_name = 'github'
                AND record_type = 'cached_repos'
                AND user_id = $1
                ORDER BY created_at DESC
                LIMIT 1
                """,
                user_id,
            )

            if not row:
                return None

            # Check if cache is stale
            cache_age = datetime.utcnow() - row["created_at"]
            if cache_age > GitHubRepoCache.CACHE_TTL:
                logger.info(
                    "GitHub repos cache for user %s is stale (age: %s)",
                    user_id,
                    cache_age,
                )
                return None

            # Parse cached data
            data = json.loads(row["data"])
            repos = data.get("repos", [])
            logger.info("Retrieved %d cached repos for user %s", len(repos), user_id)
            return repos

        finally:
            await conn.close()

    @staticmethod
    async def set_cached_repos(user_id: str, repos: List[Dict[str, Any]]) -> None:
        """Cache repositories for user.

        Args:
            user_id: User ID
            repos: List of repository objects from GitHub API
        """
        conn = await GitHubRepoCache.get_db_connection()
        try:
            # Delete old cache entry
            await conn.execute(
                """
                DELETE FROM plugin_data
                WHERE plugin_name = 'github'
                AND record_type = 'cached_repos'
                AND user_id = $1
                """,
                user_id,
            )

            # Insert new cache entry
            data = json.dumps({"repos": repos})
            await conn.execute(
                """
                INSERT INTO plugin_data (plugin_name, record_type, user_id, data, created_at, updated_at)
                VALUES ('github', 'cached_repos', $1, $2, NOW(), NOW())
                """,
                user_id,
                data,
            )

            logger.info("Cached %d repos for user %s", len(repos), user_id)

        finally:
            await conn.close()

    @staticmethod
    async def invalidate_cache(user_id: str) -> None:
        """Invalidate cached repositories for user.

        Args:
            user_id: User ID
        """
        conn = await GitHubRepoCache.get_db_connection()
        try:
            await conn.execute(
                """
                DELETE FROM plugin_data
                WHERE plugin_name = 'github'
                AND record_type = 'cached_repos'
                AND user_id = $1
                """,
                user_id,
            )
            logger.info("Invalidated cache for user %s", user_id)
        finally:
            await conn.close()
