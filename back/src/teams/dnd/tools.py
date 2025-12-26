import os
import json
import logging
import httpx
from agno.tools import Toolkit

logger = logging.getLogger(__name__)

class DnDTools(Toolkit):
    def __init__(self, room_id: str, team_id: str = "dnd"):
        super().__init__(name="dnd_tools")
        self.room_id = room_id
        self.team_id = team_id
        # Use GO_API_URL environment variable for deployed environments
        base_url = os.getenv("GO_API_URL", "http://localhost:8080")
        self.api_url = f"{base_url}/api/team/state"
        self.api_key = os.getenv("INTERNAL_API_KEY", "jules-secret-key")

        self.register(self.roll_dice)
        self.register(self.save_state)
        self.register(self.load_state)

    def roll_dice(self, expression: str) -> str:
        """
        Rolls dice based on an expression like '1d20+5' or '2d6'.
        Returns the result as a string.
        """
        import random
        import re

        # Simple parser for XdY+Z
        match = re.match(r'(\d+)d(\d+)([\+\-]\d+)?', expression)
        if not match:
            return f"Invalid dice expression: {expression}"

        count = int(match.group(1))
        sides = int(match.group(2))
        modifier = int(match.group(3)) if match.group(3) else 0

        rolls = [random.randint(1, sides) for _ in range(count)]
        total = sum(rolls) + modifier

        return f"Rolled {expression}: {rolls} {'+' if modifier >=0 else ''}{modifier} = {total}"

    def save_state(self, key: str, value) -> str:
        """
        Saves a state value to the persistent store under a specific key (e.g., 'world', 'party', 'turn').
        The value can be a dict, string, number, or any JSON-serializable object.
        """
        try:
            headers = {"X-Internal-Secret": self.api_key}
            # Normalize value to dict for storage
            if isinstance(value, dict):
                normalized_value = value
            else:
                normalized_value = {"value": value}
            
            payload = {
                "room_id": self.room_id,
                "team_id": self.team_id,
                "key": key,
                "value": normalized_value
            }
            resp = httpx.post(self.api_url, json=payload, headers=headers, timeout=5.0)
            resp.raise_for_status()
            return f"State '{key}' saved successfully."
        except Exception as e:
            logger.error(f"Failed to save state {key}: {e}")
            return f"Error saving state: {e}"

    def load_state(self, key: str) -> str:
        """
        Loads a state object (dict) from the persistent store. Returns JSON string.
        """
        try:
            headers = {"X-Internal-Secret": self.api_key}
            params = {
                "room_id": self.room_id,
                "team_id": self.team_id,
                "key": key
            }
            resp = httpx.get(self.api_url, params=params, headers=headers, timeout=5.0)
            if resp.status_code == 404:
                return "{}"
            resp.raise_for_status()
            return json.dumps(resp.json())
        except Exception as e:
            logger.error(f"Failed to load state {key}: {e}")
            return "{}"
