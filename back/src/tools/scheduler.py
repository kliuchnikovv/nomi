from typing import Optional
import os
from datetime import datetime, timedelta
import requests
from agno.agent import Agent
from agno.tools import Toolkit

class SchedulerTools(Toolkit):
    # Default to Railway production URL, can be overridden by SCHEDULER_API_URL env var
    DEFAULT_API_URL = "https://genie-api-production-7074.up.railway.app/api"
    
    def __init__(self, api_url: Optional[str] = None, user_id: Optional[str] = None, chat_id: Optional[str] = None):
        super().__init__(name="scheduler_tools")
        # Priority: explicit param > env var > default production URL
        self.api_url = api_url or os.getenv("SCHEDULER_API_URL", self.DEFAULT_API_URL)
        self.api_key = os.getenv("INTERNAL_API_KEY", "jules-secret-key") # Default for dev
        self._user_id = user_id
        self._chat_id = chat_id
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
        # Try to get context from multiple sources:
        # 1. Instance variables (set at init time)
        # 2. Agent's context attribute (if available)
        # 3. Agent's session_state (if available)
        
        user_id = self._user_id
        chat_id = self._chat_id
        
        # Try agent.context if instance vars not set
        if not user_id or not chat_id:
            agent_context = getattr(agent, 'context', None)
            if agent_context and isinstance(agent_context, dict):
                user_id = user_id or agent_context.get("user_id")
                chat_id = chat_id or agent_context.get("chat_id")
        
        # Try agent.session_state as fallback
        if not user_id or not chat_id:
            session_state = getattr(agent, 'session_state', None)
            if session_state and isinstance(session_state, dict):
                user_id = user_id or session_state.get("user_id")
                chat_id = chat_id or session_state.get("chat_id")

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
