from typing import Sequence, Optional
import logging

from agno.agent import Agent
from agno.models.base import Model
from agno.db.postgres import PostgresDb
from agno.knowledge import Knowledge, Document
from agno.tools import Toolkit, Function
from src.knowledge.factory import build_knowledge_base

logger = logging.getLogger(__name__)


class MemoriserAgent(Agent):
    """Agent that extracts memorable facts from user messages.
    
    Analyzes conversation history to identify important facts, preferences,
    and context, then stores them in a Knowledge Base for future retrieval.
    """

    MEMORY_PROMPT = (
        "You receive the last N user replies and a task description. "
        "Extract 0-3 facts/preferences/goals that should be remembered long-term. "
        "If nothing is important, return an empty list.\n\n"
        "Examples of memorable facts:\n"
        "- 'User prefers no meetings before 11 AM'\n"
        "- 'User's favorite programming language is Python'\n"
        "- 'User is working on a D&D game project'\n\n"
        "Format each fact as a clear, standalone statement."
    )

    def __init__(
        self,
        *,
        db: PostgresDb | None,
        model: Model,
        tools: Sequence[Toolkit | Function] | None = None,
        debug_mode: bool = False,
        knowledge: Optional[Knowledge] = None
    ):
        # Initialize knowledge base for storing memories
        if knowledge is None:
            knowledge = build_knowledge_base()
        
        self.knowledge = knowledge
        
        super().__init__(
            db=db,
            name="Memoriser",
            model=model,
            tools=tools,
            description="Extracts memory cards from user messages.",
            instructions=self.MEMORY_PROMPT,
            add_datetime_to_context=False,
            debug_mode=debug_mode,
            read_tool_call_history=True,
            store_tool_messages=True,
            send_media_to_model=True,
            store_media=True,
            stream=False,
        )
    
    async def store_fact(self, fact: str, metadata: dict = None) -> bool:
        """
        Store a fact in the knowledge base.
        
        Args:
            fact: The fact to store (e.g., "User prefers no meetings before 11 AM")
            metadata: Optional metadata to attach (e.g., source, timestamp)
            
        Returns:
            True if stored successfully, False otherwise
        """
        try:
            document = Document(
                content=fact,
                meta_data=metadata or {},
            )
            
            # Load the document into the knowledge base
            self.knowledge.load_documents([document])
            
            logger.info("[MemoriserAgent] Stored fact: %s", fact[:100])
            return True
        except Exception as e:
            logger.error("[MemoriserAgent] Failed to store fact: %s", e, exc_info=True)
            return False

