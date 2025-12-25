from typing import Optional
import os
from datetime import datetime, timedelta
import requests
from agno.agent import Agent
from agno.tools import Toolkit

class SchedulerTools(Toolkit):
    def __init__(self, api_url: str = "http://localhost:8080/api"):
        super().__init__(name="scheduler_tools")
        self.api_url = api_url
        self.api_key = os.getenv("INTERNAL_API_KEY", "jules-secret-key") # Default for dev
        self.register(self.schedule_task)

    def schedule_task(self, agent: Agent, message: str, time: Optional[str] = None, delay_seconds: Optional[int] = None, cron: Optional[str] = None) -> str:
        """
        Schedules a task to be executed at a specific time or after a delay.

        Args:
            message (str): The instruction or message to send to the agent when the task triggers.
            time (str): ISO 8601 formatted time string (e.g., "2023-10-27T10:00:00Z").
            delay_seconds (int): Delay in seconds from now.
            cron (str): Cron expression for recurring tasks.

        Returns:
            str: Confirmation message with Task ID or error.
        """

        # Get context from Agent (chat_id, user_id)
        # Note: Agno Agent might not expose these directly in tool signature unless passed.
        # But we can try to inspect the agent state or require the user to provide it?
        # Actually, the Agent usually runs in a context where we know the chat_id.
        # In this project, `genie.py` or the runner usually has context.

        # However, `agent` argument is passed by Agno.
        # We need `chat_id` and `user_id`.
        # These are usually available in `agent.storage` or `agent.context`.

        # Let's assume for now we can extract them from environment or Agent metadata if available.
        # If not, we might fail.

        # HACK: For now, we need to pass chat_id/user_id.
        # But the LLM doesn't know them.
        # The Python backend knows them when it receives the request.
        # We can inject them into the Tool instance when creating the Agent for the request.

        # But `SchedulerTools` is initialized once?
        # No, we can initialize it per request or use a context var.

        # Let's look at how other tools work.
        pass

        # To implement this correctly, we need the user_id and chat_id.
        # We will retrieve them from the agent's context if available,
        # or we rely on the caller to configure the tool with them.

        user_id = agent.context.get("user_id") if agent.context else None
        chat_id = agent.context.get("chat_id") if agent.context else None

        if not user_id or not chat_id:
            # Fallback: try to find them in env or global state?
            # Or ask the user? No, user doesn't know UUIDs.
            return "Error: Could not determine User ID or Chat ID from agent context."

        payload = {
            "user_id": user_id,
            "chat_id": chat_id,
            "message": message,
            "time": time,
            "delay_sec": delay_seconds,
            "cron": cron
        }

        try:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "X-Internal-Secret": self.api_key # Support both or specific internal header
            }
            response = requests.post(f"{self.api_url}/tasks", json=payload, headers=headers)
            response.raise_for_status()
            return f"Task scheduled successfully. ID: {response.json().get('task_id')}"
        except Exception as e:
            return f"Failed to schedule task: {str(e)}"
