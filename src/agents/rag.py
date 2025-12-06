from os import getenv
from typing import Sequence

from agno.agent import Agent
from agno.db.postgres import PostgresDb
from agno.knowledge.knowledge import Knowledge
from agno.models.base import Model
from agno.tools import Toolkit
from agno.vectordb.lightrag import LightRag


_DEFAULT_KNOWLEDGE_NAME = "LightRag Knowledge"
_DEFAULT_KNOWLEDGE_DESCRIPTION = (
    "LightRag powered knowledge base attached to the RAG agent."
)


def _build_light_rag_knowledge() -> Knowledge | None:
    api_key = getenv("LIGHTRAG_API_KEY")
    if not api_key:
        return None

    kwargs: dict[str, str] = {}
    endpoint = getenv("LIGHTRAG_ENDPOINT") or getenv("LIGHTRAG_BASE_URL")
    if endpoint:
        kwargs["base_url"] = endpoint
    project_id = getenv("LIGHTRAG_PROJECT_ID")
    if project_id:
        kwargs["project_id"] = project_id

    vector_db = LightRag(api_key=api_key, **kwargs)
    return Knowledge(
        name=_DEFAULT_KNOWLEDGE_NAME,
        description=_DEFAULT_KNOWLEDGE_DESCRIPTION,
        vector_db=vector_db,
    )

class RagAgent(Agent):
    """Agent that uses a RAG system for retrieval‑augmented generation.

    It receives a `retriever` tool (provided via the tools list) and a model.
    Memory management (e.g., vector store) is delegated to the tool.
    """

    def __init__(self, *, db: PostgresDb | None, model: Model, tools: Sequence[Toolkit] | None = None, debug_mode: bool = False):
        knowledge = _build_light_rag_knowledge()
        super().__init__(
            db=db,
            name="Rag",
            model=model,
            tools=tools,
            knowledge=knowledge,
            search_knowledge=bool(knowledge),
            read_chat_history=True,
            description="RAG‑based agent that can retrieve context and generate answers.",
            add_history_to_context=True,  # Required for Agno to use messages parameter
            add_datetime_to_context=True,
            debug_mode=debug_mode,
            stream=True,
        )
