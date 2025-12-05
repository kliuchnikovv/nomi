import logging
from inspect import isawaitable
from typing import List, Optional, Dict, Any, Iterable, Tuple
from uuid import UUID
from agno.tools import Toolkit

logger = logging.getLogger(__name__)

class ChatHistoryTool(Toolkit):
    name = "chat_history"
    description = "Retrieves chat history from the database"

    def __init__(self):
        super().__init__(name=self.name)
        self.register(self.get_chat_history)

    async def _call_db(
        self,
        query: str,
        params: Tuple[Any, ...],
        prefer: Optional[Iterable[str]] = None,
    ) -> Any:
        """Invoke whichever DB method is available (fetch/read/query/execute)."""
        db = getattr(self.agent, "db", None)
        if not db:
            raise AttributeError("Database connection not available")

        method_order = list(prefer or ("fetch", "read", "query", "fetch_all", "run", "execute", "write"))
        for method_name in method_order:
            method = getattr(db, method_name, None)
            if not callable(method):
                continue
            result = method(query, *params)
            return await result if isawaitable(result) else result

        raise AttributeError(
            f"Database object {type(db).__name__} lacks supported query methods ({', '.join(method_order)})"
        )

    async def get_chat_history(self, limit: int = 10, search_query: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Retrieves the message history for a specific chat.
        
        Args:
            limit: The maximum number of messages to return. Defaults to 10.
            search_query: Optional text to filter messages by content.
        """
        logger.info("=" * 80)
        logger.info("🔍 ChatHistoryTool.get_chat_history CALLED")
        logger.info("   Parameters: limit=%s, search_query=%s", limit, search_query)
        logger.info("=" * 80)
        
        # Ensure agent and db are available
        logger.debug("Step 1: Checking agent context availability")
        if not hasattr(self, "agent") or not self.agent:
            logger.error("❌ chat_history requested without agent context")
            logger.error("   hasattr(self, 'agent'): %s", hasattr(self, "agent"))
            logger.error("   self.agent: %s", getattr(self, "agent", None))
            return [{"error": "Agent not available"}]
        logger.info("✅ Agent context available: %s", type(self.agent).__name__)
        
        if not hasattr(self.agent, "db") or not self.agent.db:
            logger.error("❌ chat_history requested without database connection")
            logger.error("   hasattr(self.agent, 'db'): %s", hasattr(self.agent, "db"))
            logger.error("   self.agent.db: %s", getattr(self.agent, "db", None))
            return [{"error": "Database connection not available"}]
        logger.info("✅ Database connection available: %s", type(self.agent.db).__name__)

        # Fallback to context if not provided
        logger.debug("Step 2: Extracting chat_id and user_id from agent context")
        chat_id = getattr(self.agent, "chat_id", None)
        user_id = getattr(self.agent, "user_id", None)
        logger.info("   chat_id from agent: %s (type: %s)", chat_id, type(chat_id).__name__)
        logger.info("   user_id from agent: %s (type: %s)", user_id, type(user_id).__name__)

        if not chat_id or not user_id:
            logger.warning("❌ chat_history missing chat_id or user_id: chat_id=%s user_id=%s", chat_id, user_id)
            return [{"error": "chat_id and user_id are required in agent context"}]
        logger.info("✅ Both chat_id and user_id present")

        logger.debug("Step 3: Converting to UUID format")
        try:
            chat_uuid = UUID(chat_id) if isinstance(chat_id, str) else chat_id
            user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id
            logger.info("✅ UUID conversion successful")
            logger.info("   chat_uuid: %s", chat_uuid)
            logger.info("   user_uuid: %s", user_uuid)
        except ValueError as e:
            logger.warning("❌ chat_history received invalid UUIDs: chat_id=%s user_id=%s", chat_id, user_id)
            logger.warning("   ValueError: %s", e)
            return [{"error": "Invalid UUID format for chat_id or user_id"}]

        logger.info("-" * 80)
        logger.info("📊 Query Parameters Summary:")
        logger.info("   chat_uuid: %s", chat_uuid)
        logger.info("   user_uuid: %s", user_uuid)
        logger.info("   limit: %s", limit)
        logger.info("   search_query: %s", search_query)
        logger.info("-" * 80)

        # Check if user has access to this chat (is the owner of the chat)
        # We check if there are any messages from this user in this chat
        logger.debug("Step 4: Checking user access to chat")
        check_query = "SELECT 1 FROM messages WHERE chat_id = $1 AND sender = $2 LIMIT 1"
        logger.debug("   Access check query: %s", check_query)
        logger.debug("   Query params: chat_id=%s, sender=%s", chat_uuid, user_uuid)
        
        try:
            access = await self._call_db(
                check_query,
                (chat_uuid, user_uuid),
                prefer=("fetch", "read", "query", "fetch_all"),
            )
            logger.info("   Access check result: %s (type: %s)", access, type(access).__name__)
            
            if not access:
                logger.warning("❌ chat_history access denied: chat_id=%s user_id=%s", chat_uuid, user_uuid)
                logger.warning("   User has no messages in this chat or chat does not exist")
                return [{"error": "Access denied: User has no messages in this chat or chat does not exist"}]
            logger.info("✅ Access granted: User has messages in this chat")

            logger.debug("Step 5: Fetching message history")
            query = """
                SELECT id, chat_id, sender, role, text, created_at
                FROM messages
                WHERE chat_id = $1
                AND ($3::text IS NULL OR text ILIKE '%' || $3 || '%')
                ORDER BY created_at ASC
                LIMIT $2
            """
            logger.debug("   History query: %s", query.strip())
            logger.debug("   Query params: chat_id=%s, limit=%s, search=%s", chat_uuid, limit, search_query)
            
            rows = await self._call_db(
                query,
                (chat_uuid, limit, search_query),
                prefer=("fetch", "read", "query", "fetch_all"),
            )
            logger.info("   Raw rows fetched: %s rows (type: %s)", len(rows) if rows else 0, type(rows).__name__)

            # Convert rows to dicts if they are not already
            logger.debug("Step 6: Converting rows to dictionaries")
            results = []
            for idx, row in enumerate(rows):
                logger.debug("   Processing row %d: type=%s", idx, type(row).__name__)
                if hasattr(row, "_asdict"):
                    result = row._asdict()
                    logger.debug("      Converted via _asdict(): %s", list(result.keys()))
                    results.append(result)
                elif isinstance(row, dict):
                    logger.debug("      Already a dict: %s", list(row.keys()))
                    results.append(row)
                else:
                    # Try to convert object to dict if possible, or just return as is
                    try:
                        result = dict(row)
                        logger.debug("      Converted via dict(): %s", list(result.keys()))
                        results.append(result)
                    except Exception as conv_err:
                        logger.warning("      Failed to convert to dict: %s, using str()", conv_err)
                        results.append(str(row))
            
            logger.info("=" * 80)
            logger.info("✅ chat_history COMPLETED SUCCESSFULLY")
            logger.info("   Returned %d message(s)", len(results))
            logger.info("   chat_id: %s", chat_uuid)
            logger.info("   user_id: %s", user_uuid)
            logger.info("   search_query: %s", search_query)
            if results:
                logger.info("   First message preview: %s", str(results[0])[:100])
            logger.info("=" * 80)
            return results

        except Exception as e:
            logger.error("=" * 80)
            logger.error("❌ chat_history FAILED with exception")
            logger.error("   chat_id: %s", chat_id)
            logger.error("   user_id: %s", user_id)
            logger.error("   Exception type: %s", type(e).__name__)
            logger.error("   Exception message: %s", str(e))
            logger.exception("   Full traceback:")
            logger.error("=" * 80)
            return [{"error": f"Failed to retrieve chat history: {str(e)}"}]
