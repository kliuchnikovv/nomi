from typing import Sequence

from agno.agent import Agent
from agno.models.base import Model
from agno.db.postgres import PostgresDb
from agno.tools import Toolkit

class RagAgent(Agent):
    """Agent that uses a RAG system for retrieval‑augmented generation.

    It receives a `retriever` tool (provided via the tools list) and a model.
    Memory management (e.g., vector store) is delegated to the tool.
    """

    def __init__(self, *, db: PostgresDb | None, model: Model, tools: Sequence[Toolkit] | None = None, debug_mode: bool = False):
        super().__init__(
            db=db,
            name="Rag",
            model=model,
            tools=tools,
            description="RAG‑based agent that can retrieve context and generate answers.",
            add_history_to_context=True,
            add_datetime_to_context=True,
            debug_mode=debug_mode,
            stream=True,
        )
