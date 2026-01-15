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
        self.register(self.monitor_execution)

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
        webhook_url: Optional[str] = None,
        task_id: Optional[str] = None,
        starting_branch: str = "main",
        automation_mode: Optional[str] = None,
        title: Optional[str] = None
    ) -> str:
        """Creates a new session with Jules.

        Args:
            prompt (str): The prompt to start the session with.
            source (str): The source identifier (e.g., "sources/github/owner/repo").
            webhook_url (str, optional): URL to call when session completes.
            task_id (str, optional): ID of the task to associate with the session.
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

        if webhook_url:
            payload["webhookUrl"] = webhook_url

        if task_id:
            payload["labels"] = {
                "task_id": task_id
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

    def monitor_execution(
        self,
        session_id: str,
        task_id: str,
        architect_plan: Dict[str, Any],
        timeout_minutes: int = 15
    ) -> str:
        """
        Monitors Jules execution and updates individual step statuses in real-time.

        Args:
            session_id: Jules session ID
            task_id: Genie ProjectTask ID
            architect_plan: The original ArchitectPlan dict (containing 'steps')
            timeout_minutes: Max monitoring time

        Returns:
            str: JSON result with PR URL or error.
        """
        import os
        logger.info(f"Starting real-time monitoring for Task {task_id}, Session {session_id}")
        start_time = time.time()
        end_time = start_time + (timeout_minutes * 60)
        
        resource_path = session_id if session_id.startswith("sessions/") else f"sessions/{session_id}"
        activities_url = f"{self.base_url}/{resource_path}/activities"

        # Local state to track which steps are done to avoid duplicate updates
        steps_state = {step.get('file_path'): "pending" for step in architect_plan.get('content', {}).get('steps', [])}

        # API Config for updates
        base_url = os.getenv("API_BASE_URL", "http://api:8080")
        internal_key = os.getenv("INTERNAL_API_KEY", "jules-secret-key")
        update_url = f"{base_url}/api/project-tasks/{task_id}/status"

        while time.time() < end_time:
            try:
                # Poll activities
                resp = requests.get(activities_url, headers=self.headers, params={"pageSize": 100})
                if not resp.ok:
                    logger.warning(f"Failed to poll activities: {resp.status_code}")
                    time.sleep(10)
                    continue

                activities = resp.json().get("activities", [])
                
                # Analyze activities to update steps
                changes_detected = False
                
                for activity in activities:
                    # Look for file modifications/creations
                    # Heuristic: Check specifically for "toolCall" or "file_written" type events if available,
                    # otherwise parse generic activity if it contains file paths.
                    # Jules API structure for file ops might vary. Assuming we look for 'toolUse' or similar.
                    # Or simpler: Look for 'file' keys in metadata.
                    
                    # Assuming we can't perfectly reverse engineer Jules internal events, we'll look for filename mentions in any text field
                    # or if there's structured data.
                    
                    # Heuristic 1: If activity type is 'RunScript' or similar and mentions a file from our plan.
                    # Heuristic 2: 'toolUse' -> 'write_file'.
                    
                    # Let's iterate our planned steps and see if they appear in recent activities
                    for step in architect_plan.get('content', {}).get('steps', []):
                        path = step.get('file_path')
                        if not path: continue

                        # If already done, skip
                        if steps_state.get(path) == "completed":
                            continue

                        # Check if this activity corresponds to this file
                        # We search for the filename in the activity string representation for now
                        activity_str = json.dumps(activity)

                        if path in activity_str:
                             # Check if it indicates completion
                             # If it's a "tool output" or "success", mark as completed.
                             # If it's "tool call", mark as in_progress.

                             new_status = "in_progress"
                             if "output" in activity or "result" in activity or "Created" in activity_str or "Modified" in activity_str:
                                 new_status = "completed"

                             if steps_state[path] != new_status:
                                 steps_state[path] = new_status
                                 step['status'] = new_status
                                 changes_detected = True
                                 logger.info(f"Step updated: {path} -> {new_status}")

                    # Check for terminal states
                    if "sessionCompleted" in activity:
                        pr_url = self._extract_pr_url_from_artifacts(activity.get("artifacts", []))

                        # Mark all remaining steps as completed if session succeeded
                        for s in architect_plan.get('content', {}).get('steps', []):
                            s['status'] = 'completed'

                        # Final update
                        self._update_task_artifacts(update_url, internal_key, architect_plan)

                        if pr_url:
                            return f"Success! PR Created: {pr_url}"
                        return "Session completed (no PR URL found in artifacts)."

                    if "sessionFailed" in activity:
                        return f"Session Failed: {activity.get('sessionFailed', {}).get('reason')}"

                # If changes detected, push update to Go API
                if changes_detected:
                    self._update_task_artifacts(update_url, internal_key, architect_plan)

            except Exception as e:
                logger.error(f"Error in monitor_execution: {e}")

            time.sleep(10)

        return "Timeout waiting for session completion."

    def _update_task_artifacts(self, url: str, key: str, artifacts: Dict) -> None:
        """Helper to push updates to Go API. Wraps data in ArchitectPlan key if needed."""
        try:
            # Ensure proper nesting for frontend (task.artifacts.ArchitectPlan.steps)
            # If the artifacts dict passed here is the raw plan (with 'content'), wrap it.
            # If it already has 'ArchitectPlan' key, leave it.
            
            final_artifacts = artifacts
            if "ArchitectPlan" not in artifacts and ("content" in artifacts or "steps" in artifacts.get("content", {})):
                final_artifacts = {"ArchitectPlan": artifacts}

            payload = {
                "status": "CODING",
                "artifacts": final_artifacts
            }
            resp = requests.patch(url, json=payload, headers={"X-Internal-Secret": key})
            if not resp.ok:
                logger.warning(f"Failed to update task artifacts: {resp.text}")
        except Exception as e:
            logger.warning(f"Failed to push artifact update: {e}")

    def wait_for_pr(self, session_id: str, timeout_minutes: int = 15) -> str:
        # Legacy wrapper or simple waiter
        return self.monitor_execution(session_id, "unknown", {}, timeout_minutes)

