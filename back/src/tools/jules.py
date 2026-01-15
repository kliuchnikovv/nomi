from typing import Optional, Dict, List, Any
import json
import time
import requests
from agno.tools import Toolkit
from agno.utils.log import logger

class JulesTools(Toolkit):
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://jules.googleapis.com/v1alpha",
    ):
        super().__init__(name="jules_api")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "X-Goog-Api-Key": self.api_key,
            "Content-Type": "application/json"
        }

        self.register(self.list_sources)
        self.register(self.create_session)
        self.register(self.list_sessions)
        self.register(self.approve_plan)
        self.register(self.list_activities)
        self.register(self.send_message)
        # Removed blocking wait tools to prevent agents from timing out
        # self.register(self.wait_for_completion)
        # self.register(self.wait_for_pr)

    def _parse_error(self, response: requests.Response) -> str:
        """Parses error details from Jules API response."""
        try:
            error_data = response.json()
            if "error" in error_data:
                err = error_data["error"]
                return f"{err.get('status', 'ERROR')}: {err.get('message', 'Unknown error')} (Code: {err.get('code')})"
        except ValueError:
            pass
        return f"HTTP {response.status_code}: {response.text}"

    def _get(self, endpoint: str, params: Optional[Dict] = None) -> Dict:
        url = f"{self.base_url}/{endpoint}"
        try:
            response = requests.get(url, headers=self.headers, params=params)
            if not response.ok:
                error_msg = self._parse_error(response)
                logger.error(f"Jules API Request Failed: {error_msg}")
                return {"error": error_msg}
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Jules API Connection Failed: {e}")
            return {"error": str(e)}

    def _post(self, endpoint: str, data: Optional[Dict] = None) -> Dict:
        url = f"{self.base_url}/{endpoint}"
        try:
            response = requests.post(url, headers=self.headers, json=data or {})
            if not response.ok:
                error_msg = self._parse_error(response)
                logger.error(f"Jules API Request Failed: {error_msg}")
                return {"error": error_msg}
            
            # Handle empty responses
            if not response.content:
                return {}
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Jules API Connection Failed: {e}")
            return {"error": str(e)}

    def list_sources(self) -> str:
        """Lists available sources (e.g., GitHub repositories) connected to Jules.

        Returns:
            str: JSON string containing list of sources.
        """
        return json.dumps(self._get("sources"))

    def create_session(
        self,
        prompt: str,
        source: str,
        starting_branch: str = "main",
        automation_mode: Optional[str] = None,
        title: Optional[str] = None,
        webhook_url: Optional[str] = None
    ) -> str:
        """Creates a new session with Jules.

        Args:
            prompt (str): The prompt to start the session with.
            source (str): The source identifier (e.g., "sources/github/owner/repo").
            starting_branch (str): The branch to start from (default: "main").
            automation_mode (str): Optional mode, e.g., "AUTO_CREATE_PR".
            title (str): Optional title for the session.
            webhook_url (str): Optional webhook URL for notifications.

        Returns:
            str: JSON string containing the created session details.
        """
        payload = {
            "prompt": prompt,
            "sourceContext": {
                "source": source,
                "githubRepoContext": {
                    "startingBranch": starting_branch
                }
            }
        }
        if automation_mode:
            payload["automationMode"] = automation_mode
        if title:
            payload["title"] = title
        if webhook_url:
            # Assuming Jules API supports 'webhookUrl' or similar in payload
            # If standard API doesn't support it, we rely on polling or external integration
            # For now, adding it to payload as requested by review
            payload["webhookUrl"] = webhook_url

        return json.dumps(self._post("sessions", payload))

    def list_sessions(self, page_size: int = 5) -> str:
        """Lists recent sessions.

        Args:
            page_size (int): Number of sessions to list (default: 5).

        Returns:
            str: JSON string containing list of sessions.
        """
        return json.dumps(self._get("sessions", params={"pageSize": page_size}))

    def approve_plan(self, session_id: str) -> str:
        """Approves the current plan for a session.

        Args:
            session_id (str): The ID of the session.

        Returns:
            str: JSON string of the response.
        """
        resource_path = session_id if session_id.startswith("sessions/") else f"sessions/{session_id}"
        return json.dumps(self._post(f"{resource_path}:approvePlan"))

    def list_activities(self, session_id: str, page_size: int = 30) -> str:
        """Lists activities for a specific session.

        Args:
            session_id (str): The ID of the session.
            page_size (int): Number of activities to list.

        Returns:
            str: JSON string containing activities.
        """
        resource_path = session_id if session_id.startswith("sessions/") else f"sessions/{session_id}"
        return json.dumps(self._get(f"{resource_path}/activities", params={"pageSize": page_size}))

    def send_message(self, session_id: str, prompt: str) -> str:
        """Sends a message to an existing session.

        Args:
            session_id (str): The ID of the session.
            prompt (str): The message content.

        Returns:
            str: JSON string.
        """
        resource_path = session_id if session_id.startswith("sessions/") else f"sessions/{session_id}"
        return json.dumps(self._post(f"{resource_path}:sendMessage", data={"prompt": prompt}))
