from typing import Sequence, Optional

from agno.agent import Agent
from agno.db.postgres import PostgresDb
from agno.knowledge import Knowledge
from agno.models.base import Model
from agno.tools import Toolkit
from src.knowledge.factory import build_knowledge_base


class RagAgent(Agent):
    """Agent that uses a RAG system for retrieval-augmented generation.
    
    Uses PgVector-based Knowledge Base with GoogleGeminiEmbedder for
    semantic search over documents and user data.
    """

    def __init__(
        self,
        *,
        db: PostgresDb | None,
        model: Model,
        tools: Sequence[Toolkit] | None = None,
        debug_mode: bool = False,
        knowledge: Optional[Knowledge] = None,
        user_id: Optional[str] = None,
        learning: bool = False,
    ):
        # Use provided knowledge or build a new one
        if knowledge is None:
            knowledge = build_knowledge_base()
        
        super().__init__(
            db=db,
            name="Rag",
            model=model,
            tools=tools,
            user_id=user_id,
            learning=learning,
            knowledge=knowledge,
            search_knowledge=True,  # Enable agentic search
            update_knowledge=True,  # Enable automatic fact storage
            read_chat_history=True,
            description="RAG-based agent that can retrieve context and generate answers.",
            add_datetime_to_context=True,
            debug_mode=debug_mode,
            read_tool_call_history=True,
            send_media_to_model=True,
            store_media=True,
            stream=True,
        )


