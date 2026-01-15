from typing import Optional
import os
import json
import requests
import redis
from sqlalchemy import create_engine, text
from agno.tools import Toolkit
from agno.utils.log import logger

class TaskManagementTool(Toolkit):
    def __init__(self, api_url: Optional[str] = None, user_id: Optional[str] = None, auth_token: Optional[str] = None):
        super().__init__(name="task_management_tool")
        # Default to localhost if not specified, but should use internal docker networking in prod
        base_url = api_url or os.getenv("GO_API_URL", "http://localhost:8080/api")
        # Ensure base_url ends with /api
        if not base_url.endswith("/api"):
            base_url = f"{base_url.rstrip('/')}/api"
        self.api_url = base_url
        self.user_id = user_id
        self.auth_token = auth_token
        self.redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        self.register(self.update_task_status)
        self.register(self.list_projects)
        self.register(self.get_task_status)
        self.register(self.create_project_task)
        self.register(self.create_subtask)
        self.register(self.trigger_jules_monitoring)


    def update_task_status(self, task_id: str, status: str, pr_url: Optional[str] = None, artifacts: Optional[dict] = None) -> str:
        """
        Updates the status of a project task in the Go API.

        Args:
            task_id (str): The UUID of the task.
            status (str): The new status (e.g., 'REVIEW', 'CODING', 'DONE').
            pr_url (str, optional): The URL of the created Pull Request.
            artifacts (dict, optional): Result artifacts to store (e.g., analyst specs).

        Returns:
            str: Confirmation message or error.
        """
        if not task_id or not status:
            return "Error: task_id and status are required."

        url = f"{self.api_url}/project-tasks/{task_id}/status"
        payload = {"status": status}
        if artifacts:
            payload["artifacts"] = artifacts

        if pr_url:
            logger.info(f"Task {task_id} completed with PR: {pr_url}")

        try:
            headers = {}
            # Prioritize auth token if available (consistent with other methods)
            if self.auth_token:
                 headers["Authorization"] = f"Bearer {self.auth_token}"

            # Use internal key as fallback or if specifically needed by backend
            internal_key = os.getenv("INTERNAL_API_KEY")
            if internal_key:
                 headers["X-Internal-Secret"] = internal_key

            response = requests.patch(url, json=payload, headers=headers)
            response.raise_for_status()

            msg = f"Successfully updated task {task_id} status to {status}."
            if pr_url:
                msg += f" (PR: {pr_url})"
            return msg
        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to update task status: {e}")
            if e.response is not None:
                return f"Error updating status: {e.response.text}"
            return f"Error updating status: {str(e)}"

    def get_task_status(self, task_id: str) -> str:
        """
        Retrieves the current status of a project task.

        Args:
            task_id (str): The UUID of the task.

        Returns:
            str: The status of the task or error message.
        """
        if not task_id:
            return "Error: task_id is required."

        url = f"{self.api_url}/project-tasks/{task_id}"

        try:
            headers = {}
            # This endpoint requires auth token (wrapWithAuth)
            if self.auth_token:
                 headers["Authorization"] = f"Bearer {self.auth_token}"

            # Try internal secret as fallback if auth token missing (though API might not support it for GET)
            internal_key = os.getenv("INTERNAL_API_KEY")
            if not headers.get("Authorization") and internal_key:
                 headers["X-Internal-Secret"] = internal_key

            response = requests.get(url, headers=headers)
            response.raise_for_status()

            task = response.json()
            return task.get("status", "UNKNOWN")

        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to get task status: {e}")
            if e.response is not None:
                return f"Error getting status: {e.response.text}"
            return f"Error getting status: {str(e)}"

    def create_project_task(self, project_id: str, title: str, description: str = "", priority: str = "medium") -> str:
        """
        Creates a new task in the specified project.

        Args:
            project_id (str): The UUID of the project.
            title (str): Title of the task.
            description (str, optional): Detailed description.
            priority (str, optional): Priority (low, medium, high). Defaults to "medium".

        Returns:
            str: The ID of the created task or error message.
        """
        if not project_id or not title:
            return "Error: project_id and title are required."

        url = f"{self.api_url}/projects/{project_id}/tasks"
        payload = {
            "title": title,
            "description": description,
            "priority": priority
        }

        try:
            headers = {}
            if self.auth_token:
                 headers["Authorization"] = f"Bearer {self.auth_token}"
            else:
                return "Error: Authentication token required to create tasks."

            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()

            task = response.json()
            return f"Task created successfully. ID: {task.get('id')}"

        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to create project task: {e}")
            if e.response is not None:
                return f"Error creating task: {e.response.text}"
            return f"Error creating task: {str(e)}"

    def list_projects(self) -> str:
        """
        Lists all available projects with their IDs and names directly from the database to avoid API context issues.
        Use this to find the correct project_id before searching knowledge or creating tasks.

        Returns:
            str: A JSON formatted string list of projects or error message.
        """
        # If we have user_id and DB_DSN, query directly
        db_dsn = os.getenv("DB_DSN")
        
        if self.user_id and db_dsn:
            try:
                # Fix for SQLAlchemy 2.0+ handling of postgres://
                if db_dsn.startswith("postgres://"):
                    db_dsn = db_dsn.replace("postgres://", "postgresql://", 1)
                    
                engine = create_engine(db_dsn)
                with engine.connect() as connection:
                    # Query projects for this user that are not deleted
                    query = text("""
                        SELECT id, name, description 
                        FROM projects 
                        WHERE user_id = :uid AND deleted_at IS NULL
                    """)
                    result = connection.execute(query, {"uid": self.user_id})
                    
                    projects = []
                    for row in result:
                        p_id = str(row[0]) # Start with id
                        p_name = row[1]
                        p_desc = row[2] or ""
                        projects.append(f"ID: {p_id} | Name: {p_name} | Desc: {p_desc}")
                    
                    if not projects:
                        return "No projects found."
                        
                    return "\n".join(projects)
            except Exception as e:
                logger.error(f"Failed to list projects from DB: {e}")
                # Fallback to API if DB fails? Or just return error.
                # Given the user specifically asked for local request, we return error if it fails.
                return f"Error listing projects from DB: {str(e)}"

        # Fallback to API if no user_id or DB_DSN (legacy behavior)
        url = f"{self.api_url}/projects"
        try:
            headers = {}
            internal_key = os.getenv("INTERNAL_API_KEY")
            if internal_key:
                 headers["X-Internal-Secret"] = internal_key
            elif self.auth_token:
                 headers["Authorization"] = f"Bearer {self.auth_token}"

            response = requests.get(url, headers=headers)
            response.raise_for_status()
            
            projects = response.json()
            if not projects:
                return "No projects found."
            
            # Format nicely for the LLM
            result = []
            for p in projects:
                # Assuming the API returns keys like 'id', 'name', 'description'
                # Adjust based on your actual Go API response structure
                p_id = p.get('id', 'unknown')
                p_name = p.get('name', 'No Name')
                p_desc = p.get('description', '')
                result.append(f"ID: {p_id} | Name: {p_name} | Desc: {p_desc}")
            
            return "\n".join(result)

        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to list projects via API: {e}")
            return f"Error listing projects via API: {str(e)}"

    def create_subtask(self, parent_id: str, title: str, description: str = "") -> str:
        """
        Creates a subtask under an existing parent task.

        Args:
            parent_id (str): The UUID of the parent task.
            title (str): Title of the subtask.
            description (str, optional): Detailed description.

        Returns:
            str: The ID of the created subtask or error message.
        """
        if not parent_id or not title:
            return "Error: parent_id and title are required."

        url = f"{self.api_url}/project-tasks/{parent_id}/subtasks"
        payload = {
            "title": title,
            "description": description,
        }

        try:
            headers = {}
            if self.auth_token:
                headers["Authorization"] = f"Bearer {self.auth_token}"
            
            internal_key = os.getenv("INTERNAL_API_KEY")
            if internal_key:
                headers["X-Internal-Secret"] = internal_key

            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()

            subtask = response.json()
            return f"Subtask created successfully. ID: {subtask.get('id')}"

        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to create subtask: {e}")
            if e.response is not None:
                return f"Error creating subtask: {e.response.text}"
            return f"Error creating subtask: {str(e)}"

    def trigger_jules_monitoring(self, session_id: str, task_id: Optional[str] = None) -> str:
        """
        Triggers async monitoring of a Jules session via Redis.
        The RedisWorker will poll for completion and update task status.

        Args:
            session_id (str): The Jules session ID to monitor.
            task_id (str, optional): The internal task ID to update when done.

        Returns:
            str: Confirmation message or error.
        """
        # Use "unknown" if task_id is not provided or is None/empty
        effective_task_id = task_id if task_id else "unknown"
        
        try:
            r = redis.from_url(self.redis_url)
            message = json.dumps({"task_id": effective_task_id, "session_id": session_id})
            r.publish("jules:monitor", message)
            return f"Monitoring triggered for Task {effective_task_id} (Session {session_id})"
        except Exception as e:
            logger.error(f"Failed to trigger Jules monitoring: {e}")
            return f"Error triggering monitoring: {str(e)}"
