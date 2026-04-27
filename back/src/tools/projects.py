import json

import asyncpg
from agno.tools import Toolkit
from agno.utils.log import logger


class ProjectsTools(Toolkit):
    """Tools for browsing the user's projects."""

    def __init__(self, db_url: str, user_id: str):
        super().__init__(name="projects")
        self._db_url = db_url
        self._user_id = user_id
        self.register(self.list_projects)

    async def list_projects(self) -> str:
        """List all projects created by the user.

        Returns a JSON array of the user's projects, each with:
          - id: UUID of the project
          - name: project name
          - description: project description
          - icon: emoji icon
          - chat_count: number of chats assigned to this project

        Use this when the user asks about their projects, wants to move a chat into a
        project, or when you need to suggest relevant projects for the current topic.

        Returns:
            str: JSON array of project objects, or an error message.
        """
        if not self._db_url or not self._user_id:
            return json.dumps([])

        try:
            conn = await asyncpg.connect(
                self._db_url.replace("postgresql://", "postgres://", 1)
                if self._db_url.startswith("postgresql://")
                else self._db_url
            )
            try:
                rows = await conn.fetch(
                    """
                    SELECT
                        p.id::text        AS id,
                        p.name            AS name,
                        p.description     AS description,
                        p.icon            AS icon,
                        COUNT(c.id)       AS chat_count
                    FROM projects p
                    LEFT JOIN chats c
                        ON c.project_id = p.id
                        AND c.deleted_at IS NULL
                    WHERE p.user_id = $1::uuid
                      AND p.deleted_at IS NULL
                    GROUP BY p.id, p.name, p.description, p.icon
                    ORDER BY p.name
                    """,
                    self._user_id,
                )
            finally:
                await conn.close()
        except Exception as exc:
            logger.warning("[ProjectsTools] DB query failed: %s", exc)
            return f"Error: could not fetch projects — {exc}"

        projects = [
            {
                "id": row["id"],
                "name": row["name"],
                "description": row["description"],
                "icon": row["icon"],
                "chat_count": row["chat_count"],
            }
            for row in rows
        ]

        if not projects:
            return "The user has no projects yet."

        return json.dumps(projects, ensure_ascii=False)
