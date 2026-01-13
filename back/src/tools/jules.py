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
        self.register(self.wait_for_completion)
        self.register(self.wait_for_pr)

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

    def wait_for_completion(
        self, session_id: str, timeout_minutes: int = 30, poll_interval_seconds: int = 15
    ) -> str:
        """Polls the session activities until session completes or fails.

        This method blocks the agent execution until the session reaches a terminal state
        (completed or failed) or the timeout is reached.

        Args:
            session_id (str): The ID of the session to monitor.
            timeout_minutes (int): Maximum time to wait in minutes (default: 30).
            poll_interval_seconds (int): Interval between polls in seconds (default: 15).

        Returns:
            str: JSON string containing:
                - 'status': 'completed' | 'failed' | 'timeout'
                - 'reason': Error reason if failed
                - 'artifacts': List of artifacts if completed (changeSets, etc.)
                - 'pr_url': PR URL if found in artifacts
        """
        start_time = time.time()
        end_time = start_time + (timeout_minutes * 60)
        resource_path = session_id if session_id.startswith("sessions/") else f"sessions/{session_id}"

        logger.info(f"Polling Jules session {session_id} for completion (timeout: {timeout_minutes}m)")

        while time.time() < end_time:
            try:
                activities_data = self._get(f"{resource_path}/activities", params={"pageSize": 50})
                activities = activities_data.get("activities", [])

                for activity in activities:
                    # Check for session completed
                    if "sessionCompleted" in activity:
                        logger.info(f"Jules session {session_id} completed successfully")
                        result = {
                            "status": "completed",
                            "artifacts": activity.get("artifacts", [])
                        }
                        # Try to find PR URL in artifacts
                        pr_url = self._extract_pr_url_from_artifacts(activity.get("artifacts", []))
                        if pr_url:
                            result["pr_url"] = pr_url
                        return json.dumps(result)

                    # Check for session failed
                    if "sessionFailed" in activity:
                        failed_data = activity.get("sessionFailed", {})
                        reason = failed_data.get("reason", "Unknown error")
                        logger.warning(f"Jules session {session_id} failed: {reason}")
                        return json.dumps({
                            "status": "failed",
                            "reason": reason
                        })

            except Exception as e:
                logger.warning(f"Error polling Jules activities: {e}")

            time.sleep(poll_interval_seconds)

        return json.dumps({
            "status": "timeout",
            "error": f"Session did not complete within {timeout_minutes} minutes."
        })

    def _extract_pr_url_from_artifacts(self, artifacts: List[Any]) -> Optional[str]:
        """Extracts a Pull Request URL from artifacts if present."""
        for artifact in artifacts:
            if isinstance(artifact, dict):
                # Check for changeSet with GitHub PR
                change_set = artifact.get("changeSet", {})
                git_patch = change_set.get("gitPatch", {})
                if "pullRequestUrl" in git_patch:
                    return git_patch["pullRequestUrl"]
                # Check for direct PR metadata
                if "pullRequest" in artifact:
                    return artifact["pullRequest"].get("url")
        return None

    def wait_for_pr(self, session_id: str, timeout_minutes: int = 15) -> str:
        """
        Waits for a Pull Request to be created in the session.
        Polls the session activities and status.
        """
        logger.info(f"Starting to poll Jules session {session_id} for PR creation (timeout: {timeout_minutes}m)")
        start_time = time.time()
        end_time = start_time + (timeout_minutes * 60)
        
        # Normalize session_id to ensure it's a valid resource path
        resource_path = session_id if session_id.startswith("sessions/") else f"sessions/{session_id}"
        session_url = f"{self.base_url}/{resource_path}"
        activities_url = f"{self.base_url}/{resource_path}/activities"

        while time.time() < end_time:
            try:
                # 1. First check the session status itself
                session_resp = requests.get(session_url, headers=self.headers)
                
                if not session_resp.ok:
                    if session_resp.status_code == 404:
                        return f"Error: Session {session_id} not found or expired. Please retry creating a session."
                    # Fatal client errors should stop the polling immediately
                    if 400 <= session_resp.status_code < 500 and session_resp.status_code != 429:
                        return f"Fatal Error checking session: {self._parse_error(session_resp)}"
                    # Server errors (5xx) or Rate Limit (429) will be ignored for this check, hoping for recovery or just retrying via loop
                else:
                    session_data = session_resp.json()
                    # Check for inactive statuses
                    state = session_data.get("state", "STATE_UNSPECIFIED")
                    if state in ["STOPPED", "FAILED", "INACTIVE", "CANCELLED"]:
                        return f"Error: Session stopped prematurely with state: {state}. No PR was created."

                # 2. Check activities for PR existence (with pagination)
                # We must fetch recent activities until we find the PR or exhaust the search
                # Since order is unspecified/unreliable, we might need to sweep multiple pages 
                # if there are many activities.
                
                activities = []
                page_token = None
                
                # We limit the depth of search to avoid fetching thousands of activities if something goes wrong
                max_pages = 5 
                
                for _ in range(max_pages):
                    params = {"pageSize": 100} # Fetch more per page
                    if page_token:
                        params["pageToken"] = page_token
                        
                    resp = requests.get(activities_url, headers=self.headers, params=params)
                    
                    if not resp.ok:
                        if resp.status_code == 404:
                            # If page token becomes invalid or session lost
                            break 
                        if 400 <= resp.status_code < 500 and resp.status_code != 429:
                            break # Fatal error
                        # Ignore other errors and retry outer loop
                        break
                    
                    data = resp.json()
                    page_activities = data.get("activities", [])
                    activities.extend(page_activities)
                    
                    page_token = data.get("nextPageToken")
                    if not page_token:
                        break
                
                # Now scan all collected activities
                for activity in activities:
                    # Look for PR creation activity
                    if activity.get("type") == "PULL_REQUEST_CREATED":
                        metadata = activity.get("pullRequestCreated", {})
                        pr_url = metadata.get("url", "URL not found")
                        return f"Success! Pull Request created: {pr_url}"
                    
                    # Check for session completed (might imply PR is ready in artifacts)
                    if "sessionCompleted" in activity:
                        # Session completed - check for PR in artifacts
                        pr_url = self._extract_pr_url_from_artifacts(activity.get("artifacts", []))
                        if pr_url:
                            return json.dumps({"status": "success", "pr_url": pr_url})
                        else:
                            return json.dumps({
                                "status": "completed_no_pr",
                                "message": "Session completed but no PR was created"
                            })

                    # Check for session failed
                    if "sessionFailed" in activity:
                        failed_data = activity.get("sessionFailed", {})
                        reason = failed_data.get("reason", "Unknown error")
                        logger.warning(f"Jules session {session_id} failed: {reason}")
                        return json.dumps({
                            "status": "failed",
                            "error": reason
                        })

                    # Additionally: if we see an error in activities
                    if activity.get("type") == "ERROR" or "error" in activity:
                         return f"Error reported by Jules: {activity.get('error', {}).get('message', 'Unknown error')}"

            except requests.exceptions.RequestException as e:
                logger.error(f"Jules API polling error: {e}")
                # Don't exit immediately, give a chance for temporary network glitch
            
            time.sleep(10)  # Pause before next poll

        return "Timeout: No Pull Request was created within the allocated time."

