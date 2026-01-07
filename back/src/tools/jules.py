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
        self.register(self.wait_for_pr)

    def _get(self, endpoint: str, params: Optional[Dict] = None) -> Dict:
        url = f"{self.base_url}/{endpoint}"
        try:
            response = requests.get(url, headers=self.headers, params=params)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Jules API Request Failed: {e}")
            if e.response is not None:
                logger.error(f"Response: {e.response.text}")
            return {"error": str(e)}

    def _post(self, endpoint: str, data: Optional[Dict] = None) -> Dict:
        url = f"{self.base_url}/{endpoint}"
        try:
            response = requests.post(url, headers=self.headers, json=data or {})
            response.raise_for_status()
            # Handle empty responses
            if not response.content:
                return {}
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Jules API Request Failed: {e}")
            if e.response is not None:
                logger.error(f"Response: {e.response.text}")
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
        title: Optional[str] = None
    ) -> str:
        """Creates a new session with Jules.

        Args:
            prompt (str): The prompt to start the session with.
            source (str): The source identifier (e.g., "sources/github/owner/repo").
            starting_branch (str): The branch to start from (default: "main").
            automation_mode (str): Optional mode, e.g., "AUTO_CREATE_PR".
            title (str): Optional title for the session.

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
            session_id (str): The ID of the session (can be the full name "sessions/..." or just the ID).

        Returns:
            str: JSON string of the response (usually empty or confirmation).
        """
        # Ensure ID format if needed, but API usually accepts full resource name or ID in URL path
        # Documentation says: sessions/SESSION_ID:approvePlan
        # If user passes just ID, we might need to prepend 'sessions/', but let's assume they pass what they get from list_sessions
        # Actually, list_sessions returns "name": "sessions/..." and "id": "...".
        # The API URL pattern is `sessions/SESSION_ID:approvePlan`.
        # If `session_id` provided is just the number, we might need to be careful.
        # Let's handle both.

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
            str: JSON string (response will be empty, use list_activities to see reply).
        """
        resource_path = session_id if session_id.startswith("sessions/") else f"sessions/{session_id}"
        return json.dumps(self._post(f"{resource_path}:sendMessage", data={"prompt": prompt}))

    def wait_for_pr(self, session_id: str, timeout_minutes: int = 10) -> str:
        """Polls the session activities for a Pull Request creation event.

        This method blocks the agent execution until a PR is created or the timeout is reached.

        Args:
            session_id (str): The ID of the session to monitor.
            timeout_minutes (int): Maximum time to wait in minutes (default: 10).

        Returns:
            str: JSON string containing 'status' and 'pr_url' if found, or 'error' if timed out.
        """
        start_time = time.time()
        end_time = start_time + (timeout_minutes * 60)
        resource_path = session_id if session_id.startswith("sessions/") else f"sessions/{session_id}"

        logger.info(f"Starting to poll Jules session {session_id} for PR creation (timeout: {timeout_minutes}m)")

        while time.time() < end_time:
            try:
                # Fetch recent activities
                activities_data = self._get(f"{resource_path}/activities", params={"pageSize": 20})
                activities = activities_data.get("activities", [])

                for activity in activities:
                    # Look for activities that indicate a PR was created.
                    # This relies on the specific payload structure of Jules activities.
                    # Usually, there's a type or kind, or we search text content.
                    # Assumption: Jules returns an activity with 'githubPr' or similar metadata,
                    # or the 'reasoning' / 'text' contains the link.
                    # Let's inspect 'activityType' or specific fields if documented.
                    # Without strict docs, we look for 'pullRequest' in payload or text.

                    # Common structure might be activity -> detail -> pullRequest -> url

                    # 1. Check direct metadata if available (hypothetical based on standard Google Cloud APIs)
                    if "metadata" in activity:
                        metadata = activity["metadata"]
                        if "pullRequest" in metadata:
                            pr_url = metadata["pullRequest"].get("url")
                            if pr_url:
                                return json.dumps({"status": "success", "pr_url": pr_url})

                    # 2. Check text content for "Pull Request created" + URL
                    text_content = activity.get("text", "")
                    if "github.com" in text_content and "/pull/" in text_content:
                         # Simple extraction (naive)
                         words = text_content.split()
                         for word in words:
                             if "github.com" in word and "/pull/" in word:
                                 # Clean up trailing punctuation
                                 url = word.rstrip(".,;:)")
                                 return json.dumps({"status": "success", "pr_url": url})

            except Exception as e:
                logger.warning(f"Error polling Jules activities: {e}")

            # Wait before next poll
            time.sleep(15)

        return json.dumps({"status": "timeout", "error": f"No PR created within {timeout_minutes} minutes."})
