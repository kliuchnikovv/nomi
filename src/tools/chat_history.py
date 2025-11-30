from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime
from agno.tools import Toolkit
from agno.agent import Agent

class ChatHistoryTool(Toolkit):
    name = "chat_history"
    description = "Retrieves chat history from the database"

    def __init__(self, agent: Agent):
        super().__init__(name=self.name)
        self.agent = agent
        self.register(self.get_chat_history)

    async def get_chat_history(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Retrieves the message history for a specific chat.
        
        Args:
            limit: The maximum number of messages to return. Defaults to 10.
            user_id: The ID of the user requesting the history. If not provided, tries to use the current user ID from context.
            limit: The maximum number of messages to return. Defaults to 10.
        """
        # Ensure db is available
        if not hasattr(self.agent, "db") or not self.agent.db:
             return [{"error": "Database connection not available"}]

        # Fallback to context if not provided
        if hasattr(self.agent, "chat_id"):
            chat_id = self.agent.chat_id
        if hasattr(self.agent, "user_id"):
            user_id = self.agent.user_id

        if not chat_id or not user_id:
            return [{"error": "chat_id and user_id are required"}]

        try:
            chat_uuid = UUID(chat_id) if isinstance(chat_id, str) else chat_id
            user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id
        except ValueError:
            return [{"error": "Invalid UUID format for chat_id or user_id"}]

        # Check if user has access to this chat (is the owner of the chat)
        # Based on the Chat struct: UserID is the owner.
        check_query = "SELECT 1 FROM chats WHERE id = $1 AND user_id = $2 LIMIT 1"
        try:
            # We try 'fetch' first, as it is common for asyncpg wrappers
            if hasattr(self.agent.db, "fetch"):
                access = await self.agent.db.fetch(check_query, chat_uuid, user_uuid)
            elif hasattr(self.agent.db, "read"):
                access = await self.agent.db.read(check_query, chat_uuid, user_uuid)
            else:
                # Fallback: try execute and see if it returns something iterable
                access = await self.agent.db.execute(check_query, chat_uuid, user_uuid)
            
            if not access:
                return [{"error": "Access denied: User is not the owner of this chat or chat does not exist"}]

            query = """
                SELECT id, chat_id, user_id, role, text, created_at
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
