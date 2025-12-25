from typing import Optional, List, Any
import os
from datetime import datetime, timedelta
import requests
import json
from agno.agent import Agent
from agno.tools import Toolkit

class SchedulerTools(Toolkit):
    # Default to Railway production URL, can be overridden by SCHEDULER_API_URL env var
    DEFAULT_API_URL = "https://genie-api-production-7074.up.railway.app/api"
    
    def __init__(self, api_url: Optional[str] = None, user_id: Optional[str] = None, chat_id: Optional[str] = None, tools_list: Optional[List[Any]] = None):
        super().__init__(name="scheduler_tools")
        # Priority: explicit param > env var > default production URL
        self.api_url = api_url or os.getenv("SCHEDULER_API_URL", self.DEFAULT_API_URL)
        self.api_key = os.getenv("INTERNAL_API_KEY", "jules-secret-key") # Default for dev
        self._user_id = user_id
        self._chat_id = chat_id
        self._tools_list = tools_list or []
        print(f"[SchedulerTools.__init__] Initialized with {len(self._tools_list)} tools")
        if self._tools_list:
            print(f"[SchedulerTools.__init__] Tools: {[getattr(t, 'name', type(t).__name__) for t in self._tools_list]}")
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

        # Serialize tools_list to JSON format expected by Go API
        # For now, just save tool names - we'll reconstruct them from user's integrations during execution
        tools_json = None
        if self._tools_list:
            try:
                print(f"[SchedulerTools] Serializing {len(self._tools_list)} tools")
                # Just save tool names for simplicity
                tools_json = []
                for tool in self._tools_list:
                    tool_name = getattr(tool, 'name', str(tool))
                    tools_json.append({"name": tool_name})
                    print(f"[SchedulerTools] Serialized tool: {tool_name}")
                
                print(f"[SchedulerTools] Serialized {len(tools_json)} tool names to JSON")
            except Exception as e:
                print(f"Warning: Could not serialize tools: {e}")
                import traceback
                traceback.print_exc()

        payload = {
            "user_id": user_id,
            "chat_id": chat_id,
            "message": message,
            "tools": tools_json,  # Include tools from creation time
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

