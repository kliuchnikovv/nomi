import logging
from inspect import isawaitable
from typing import List, Optional, Dict, Any, Iterable, Tuple
from uuid import UUID
from agno.tools import Toolkit

logger = logging.getLogger(__name__)

class ChatHistoryTool(Toolkit):
    name = "chat_history"
    description = (
        "Retrieves message history from the current chat. "
        "Use this to recall previous messages, search conversation history, "
        "or filter messages by role (user/assistant) or time period. "
        "Always available for the current chat context."
    )

    def __init__(self):
        super().__init__(name=self.name)
        self.register(self.get_chat_history)

    async def _call_db(
        self,
        query: str,
        params: Tuple[Any, ...],
        prefer: Optional[Iterable[str]] = None,
    ) -> Any:
        """Execute a database query using PostgresDb's SQLAlchemy session."""
        from sqlalchemy.sql.expression import text
        from sqlalchemy import bindparam
        
        logger.debug("   📞 _call_db called")
        logger.debug("      Query: %s", query.strip()[:100])
        logger.debug("      Params: %s", params)
        
        db = getattr(self.agent, "db", None)
        if not db:
            logger.error("      ❌ Database connection not available")
            raise AttributeError("Database connection not available")
        
        logger.debug("      Database type: %s", type(db).__name__)
        logger.info("      ✅ Using PostgresDb.Session() with SQLAlchemy")
        
        try:
            # PostgresDb uses SQLAlchemy, so we need to use Session() context manager
            with db.Session() as sess:
                # Convert PostgreSQL positional parameters ($1, $2, etc.) to named parameters
                # SQLAlchemy text() works better with named parameters
                converted_query = query
                param_dict = {}
                
                for i, param_value in enumerate(params, start=1):
                    placeholder = f"${i}"
                    param_name = f"param_{i}"
                    converted_query = converted_query.replace(placeholder, f":{param_name}")
                    param_dict[param_name] = param_value
                
                logger.debug("      Converted query: %s", converted_query.strip()[:100])
                logger.debug("      Param dict: %s", param_dict)
                
                # Execute query with named parameters
                stmt = text(converted_query)
                result = sess.execute(stmt, param_dict)
                rows = result.fetchall()
                
                logger.debug("      Result type: %s", type(rows).__name__)
                logger.debug("      Result length: %s", len(rows) if rows else 0)
                
                return rows
                
        except Exception as e:
            logger.error("      ❌ Database query failed: %s", e)
            raise

    async def get_chat_history(
        self, 
        limit: int = 10, 
        search_query: Optional[str] = None,
        sender_role: Optional[str] = None,
        from_timestamp: Optional[int] = None,
        to_timestamp: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Retrieves message history for the current chat with optional filtering.
        
        Args:
            limit: Maximum number of messages to return (default: 10, max recommended: 50)
            search_query: Search for messages containing this text (case-insensitive)
            sender_role: Filter by message sender - 'user' for user messages, 'assistant' for AI responses
            from_timestamp: Show messages after this Unix timestamp (seconds since epoch)
            to_timestamp: Show messages before this Unix timestamp (seconds since epoch)
            
        Returns:
            List of message dictionaries with keys: id, chat_id, user_id, role, text, created_at
            Returns [{"error": "..."}] if an error occurs
            
        Examples:
            # Get last 5 messages
            get_chat_history(limit=5)
            
            # Search for messages about Python
            get_chat_history(search_query="Python")
            
            # Get only user messages
            get_chat_history(sender_role="user")
            
            # Get messages from last hour
            get_chat_history(from_timestamp=int(time.time()) - 3600)
            
            # Combine filters
            get_chat_history(sender_role="assistant", search_query="database", limit=3)
        """
        logger.info("=" * 80)
        logger.info("🔍 ChatHistoryTool.get_chat_history CALLED")
        logger.info("   Parameters:")
        logger.info("      limit=%s", limit)
        logger.info("      search_query=%s", search_query)
        logger.info("      sender_role=%s", sender_role)
        logger.info("      from_timestamp=%s", from_timestamp)
        logger.info("      to_timestamp=%s", to_timestamp)
        logger.info("=" * 80)
        
        # Log to console as well for visibility
        print(f"\n{'='*80}")
        print(f"🔧 ChatHistoryTool INVOKED")
        print(f"   limit={limit}, search_query={search_query}, sender_role={sender_role}")
        print(f"{'='*80}\n")
        
        # Validate sender_role if provided
        if sender_role and sender_role not in ['user', 'assistant']:
            logger.warning("❌ Invalid sender_role: %s (must be 'user' or 'assistant')", sender_role)
            return [{"error": f"Invalid sender_role: {sender_role}. Must be 'user' or 'assistant'"}]
        
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
        logger.info("   sender_role: %s", sender_role)
        logger.info("   from_timestamp: %s", from_timestamp)
        logger.info("   to_timestamp: %s", to_timestamp)
        logger.info("-" * 80)

        # Check if user has access to this chat (is the owner of the chat)
        # We check if there are any messages from this user in this chat
        logger.debug("Step 4: Checking user access to chat")
        check_query = "SELECT 1 FROM messages WHERE chat_id = $1 AND user_id = $2 LIMIT 1"
        logger.debug("   Access check query: %s", check_query)
        logger.debug("   Query params: chat_id=%s, user_id=%s", chat_uuid, user_uuid)
        
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

            logger.debug("Step 5: Building query with filters")
            
            # Build dynamic query based on filters
            query_conditions = ["chat_id = $1"]
            query_params = [chat_uuid]
            param_index = 2
            
            # Add search filter
            if search_query:
                query_conditions.append(f"text ILIKE '%' || ${param_index} || '%'")
                query_params.append(search_query)
                param_index += 1
            
            # Add sender role filter
            if sender_role:
                query_conditions.append(f"role = ${param_index}")
                query_params.append(sender_role)
                param_index += 1
            
            # Add time window filters
            if from_timestamp:
                query_conditions.append(f"created_at >= ${param_index}")
                query_params.append(from_timestamp)
                param_index += 1
            
            if to_timestamp:
                query_conditions.append(f"created_at <= ${param_index}")
                query_params.append(to_timestamp)
                param_index += 1
            
            # Construct final query
            where_clause = " AND ".join(query_conditions)
            query = f"""
                SELECT id, chat_id, user_id, role, text, created_at
                FROM messages
                WHERE {where_clause}
                ORDER BY created_at ASC
                LIMIT ${param_index}
            """
            query_params.append(limit)
            
            logger.debug("   History query: %s", query.strip())
            logger.debug("   Query params: %s", query_params)
            
            rows = await self._call_db(
                query,
                tuple(query_params),
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
            logger.info("   Filters applied:")
            logger.info("      search_query: %s", search_query if search_query else "None")
            logger.info("      sender_role: %s", sender_role if sender_role else "None")
            logger.info("      time_window: %s to %s", from_timestamp if from_timestamp else "None", to_timestamp if to_timestamp else "None")
            if results:
                logger.info("   First message preview: %s", str(results[0])[:100])
            logger.info("=" * 80)
            
            # Console output for visibility
            print(f"\n{'='*80}")
            print(f"✅ ChatHistoryTool COMPLETED: {len(results)} messages returned")
            print(f"{'='*80}\n")
            
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
