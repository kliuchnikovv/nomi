from typing import Sequence, Optional
import logging

from agno.agent import Agent
from agno.models.base import Model
from agno.db.postgres import PostgresDb
from agno.knowledge import Knowledge
from agno.tools import Toolkit, Function
from src.knowledge.factory import build_knowledge_base

logger = logging.getLogger(__name__)


class MemoriserAgent(Agent):
    """Agent that extracts memorable facts from user messages.
    
    Analyzes conversation history to identify important facts, preferences,
    and context, then stores them in a Knowledge Base for future retrieval.
    """

    MEMORY_PROMPT = (
        "You receive conversation history and the latest user message. "
        "Extract 0-5 facts, preferences, or constraints that should be remembered long-term for personalization. "
        "If nothing is important, return nothing.\n\n"
        "Capture BOTH explicit and IMPLICIT information:\n"
        "- Explicit: 'User prefers no meetings before 11 AM', 'User loves Python', 'User is working on a D&D project'\n"
        "- Implicit: 'User does not speak Spanish' (from 'we only know English'), "
        "'User is going with their spouse' (from 'with my wife'), "
        "'User prefers English only', 'User has dietary restrictions', "
        "languages they know or don't know, who they travel with, constraints they mention.\n\n"
        "Format each fact as a single clear line, one per line. No numbering or bullets. "
        "Each line must be a standalone statement about the user (e.g. 'User prefers X', 'User does not Y')."
    )

    def __init__(
        self,
        *,
        db: PostgresDb | None,
        model: Model,
        tools: Sequence[Toolkit | Function] | None = None,
        debug_mode: bool = False,
        knowledge: Optional[Knowledge] = None,
        user_id: Optional[str] = None,
        learning: bool = False,
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
            user_id=user_id,
            learning=learning,
            knowledge=knowledge,
            search_knowledge=(knowledge is not None),  # Enable agentic search if knowledge provided
            update_knowledge=(knowledge is not None),  # Enable automatic fact storage
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
        Uses insert() so UserKnowledgeAdapter (if present) adds user_id to metadata.
        """
        try:
            meta = dict(metadata or {})
            self.knowledge.insert(text_content=fact, metadata=meta)
            logger.info("[MemoriserAgent] Stored fact: %s", fact[:100])
            return True
        except Exception as e:
            logger.error("[MemoriserAgent] Failed to store fact: %s", e, exc_info=True)
            return False

