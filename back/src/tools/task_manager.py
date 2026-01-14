from typing import Optional, List, Any
import os
import requests
import json
from agno.agent import Agent
from agno.tools import Toolkit
from agno.utils.log import logger

class TaskManagementTool(Toolkit):
    def __init__(self, api_url: Optional[str] = None):
        super().__init__(name="task_management_tool")
        # Default to localhost if not specified, but should use internal docker networking in prod
        self.api_url = api_url or os.getenv("GO_API_URL", "http://localhost:8080/api")
        self.register(self.update_task_status)
        self.register(self.list_projects)

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

        # Note: The Go API currently only supports status updates via this endpoint.
        # If pr_url is provided, we should ideally store it.
        # Since I cannot modify the Go API in this task, I will log it.
        # In a future iteration (GENIE-005/GENIE-001), the Go API should support metadata updates.
        if pr_url:
            logger.info(f"Task {task_id} completed with PR: {pr_url}")
            # Potential workaround: Add to payload if API is updated later,
            # or try to update description if a separate endpoint exists.
            # For now, we just proceed with status update.

        try:
            # We assume internal networking allows this without complex auth for now,
            # or relies on the same network security.
            # If auth is needed, we would need to pass a token or secret.
            # Based on SchedulerTools, there might be an internal key.
            headers = {}
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

    def list_projects(self) -> str:
        """
        Lists all available projects with their IDs and names.
        Use this to find the correct project_id before searching knowledge or creating tasks.

        Returns:
            str: A JSON formatted string list of projects or error message.
        """
        url = f"{self.api_url}/projects"
        try:
            headers = {}
            internal_key = os.getenv("INTERNAL_API_KEY")
            if internal_key:
                 headers["X-Internal-Secret"] = internal_key

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
            logger.error(f"Failed to list projects: {e}")
            return f"Error listing projects: {str(e)}"
