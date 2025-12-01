import logging
from typing import List, Optional, Dict, Any
from uuid import UUID
from agno.tools import Toolkit

logger = logging.getLogger(__name__)

class ChatHistoryTool(Toolkit):
    name = "chat_history"
    description = "Retrieves chat history from the database"

    def __init__(self):
        super().__init__(name=self.name)
        self.register(self.get_chat_history)

    async def get_chat_history(self, limit: int = 10, search_query: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Retrieves the message history for a specific chat.
        
        Args:
            limit: The maximum number of messages to return. Defaults to 10.
            search_query: Optional text to filter messages by content.
        """
        # Ensure agent and db are available
        if not hasattr(self, "agent") or not self.agent:
            logger.error("chat_history requested without agent context")
            return [{"error": "Agent not available"}]
        if not hasattr(self.agent, "db") or not self.agent.db:
            logger.error("chat_history requested without database connection")
            return [{"error": "Database connection not available"}]

        # Fallback to context if not provided
        chat_id = getattr(self.agent, "chat_id", None)
        user_id = getattr(self.agent, "user_id", None)

        if not chat_id or not user_id:
            logger.warning("chat_history missing chat_id or user_id: chat_id=%s user_id=%s", chat_id, user_id)
            return [{"error": "chat_id and user_id are required in agent context"}]

        try:
            chat_uuid = UUID(chat_id) if isinstance(chat_id, str) else chat_id
            user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id
        except ValueError:
            logger.warning("chat_history received invalid UUIDs: chat_id=%s user_id=%s", chat_id, user_id)
            return [{"error": "Invalid UUID format for chat_id or user_id"}]

        logger.debug(
            "chat_history fetching messages: chat_id=%s user_id=%s limit=%s search=%s",
            chat_uuid,
            user_uuid,
            limit,
            search_query,
        )

        # Check if user has access to this chat (is the owner of the chat)
        # We check if there are any messages from this user in this chat
        check_query = "SELECT 1 FROM messages WHERE chat_id = $1 AND sender = $2 LIMIT 1"
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
                logger.warning("chat_history access denied: chat_id=%s user_id=%s", chat_uuid, user_uuid)
                return [{"error": "Access denied: User has no messages in this chat or chat does not exist"}]

            query = """
                SELECT id, chat_id, sender, role, text, created_at
                FROM messages
                WHERE chat_id = $1
                AND ($3::text IS NULL OR text ILIKE '%' || $3 || '%')
                ORDER BY created_at ASC
                LIMIT $2
            """
            
            if hasattr(self.agent.db, "fetch"):
                rows = await self.agent.db.fetch(query, chat_uuid, limit, search_query)
            elif hasattr(self.agent.db, "read"):
                rows = await self.agent.db.read(query, chat_uuid, limit, search_query)
            else:
                rows = await self.agent.db.execute(query, chat_uuid, limit, search_query)

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
            
            logger.info(
                "chat_history returned %d message(s): chat_id=%s user_id=%s search=%s",
                len(results),
                chat_uuid,
                user_uuid,
                search_query,
            )
            return results

        except Exception as e:
            logger.exception("chat_history failed: chat_id=%s user_id=%s", chat_id, user_id)
            return [{"error": f"Failed to retrieve chat history: {str(e)}"}]
