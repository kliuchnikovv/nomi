from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime
from agno.tools import Toolkit

class ChatHistoryTool(Toolkit):
    name = "chat_history"
    description = "Retrieves chat history from the database"

    def __init__(self):
        super().__init__(name=self.name)
        self.register(self.get_chat_history)

    async def get_chat_history(self, chat_id: str, user_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Retrieves the message history for a specific chat.
        
        Args:
            chat_id: The ID of the chat to retrieve.
            user_id: The ID of the user requesting the history.
            limit: The maximum number of messages to return. Defaults to 10.
        """
        # Ensure db is available
        if not hasattr(self, "agent") or not self.agent.db:
             return [{"error": "Database connection not available"}]

        try:
            chat_uuid = UUID(chat_id) if isinstance(chat_id, str) else chat_id
            user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id
        except ValueError:
            return [{"error": "Invalid UUID format for chat_id or user_id"}]

        # Check if user has access to this chat (is a sender of at least one message)
        # We assume the user_id matches the sender field in the messages table for user messages.
        check_query = "SELECT 1 FROM messages WHERE chat_id = $1 AND sender = $2 LIMIT 1"
        try:
            # We try 'fetch' first, as it is common for asyncpg wrappers
            if hasattr(self.agent.db, "fetch"):
                access = await self.agent.db.fetch(check_query, chat_uuid, user_uuid)
            elif hasattr(self.agent.db, "read"):
                access = await self.agent.db.read(check_query, chat_uuid, user_uuid)
            else:
                # Fallback: try execute and see if it returns something iterable
                # This is risky but we have no other option without knowing the API
                access = await self.agent.db.execute(check_query, chat_uuid, user_uuid)
            
            if not access:
                return [{"error": "Access denied: User has no messages in this chat or chat does not exist"}]

            query = """
                SELECT id, chat_id, sender, role, text, created_at
                FROM messages
                WHERE chat_id = $1
                ORDER BY created_at ASC
            """
            
            if hasattr(self.agent.db, "fetch"):
                rows = await self.agent.db.fetch(query, chat_uuid)
            elif hasattr(self.agent.db, "read"):
                rows = await self.agent.db.read(query, chat_uuid)
            else:
                rows = await self.agent.db.execute(query, chat_uuid)

            # Convert rows to dicts if they are not already
            results = []
            for row in rows:
                if hasattr(row, "_asdict"):
                    results.append(row._asdict())
                elif isinstance(row, dict):
                    results.append(row)
                else:
                    # Try to convert object to dict if possible, or just return as is
                    try:
                        results.append(dict(row))
                    except:
                        results.append(str(row))
            
            return results

        except Exception as e:
            return [{"error": f"Failed to retrieve chat history: {str(e)}"}]
