"""
Knowledge Base Factory for Agno Agentic RAG.

This module provides factory functions to create and configure:
- PgVector vector database using existing Postgres connection
- PostgresDb contents DB for knowledge content tracking (optional)
- GeminiEmbedder for generating embeddings via Google Gemini API
- Knowledge base for RAG functionality
"""

import logging
import os
from typing import Optional

from sqlalchemy import create_engine
from agno.db.postgres import PostgresDb
from agno.knowledge import Knowledge
from agno.vectordb.pgvector import PgVector
from agno.knowledge.embedder.google import GeminiEmbedder

logger = logging.getLogger(__name__)

# Default configuration
DEFAULT_TABLE_NAME = "agent_knowledge"
DEFAULT_CONTENTS_TABLE = "agent_knowledge_contents"
DEFAULT_EMBEDDER_MODEL = "text-embedding-004"  # Google's latest embedding model
DEFAULT_CHUNK_SIZE = 3000  # Good for code and documents
DEFAULT_CHUNK_OVERLAP = 300  # 10% overlap for context continuity

# Embedding dimensions by model
EMBEDDING_DIMENSIONS = {
    "text-embedding-004": 768,
    "models/text-embedding-004": 768,
}


def build_vector_db(
    db_url: Optional[str] = None,
    table_name: str = DEFAULT_TABLE_NAME,
    embedder_model: str = DEFAULT_EMBEDDER_MODEL,
) -> PgVector:
    """
    Build a PgVector instance.
    """
    # Get database URL from environment if not provided
    if db_url is None:
        db_url = os.getenv("DB_DSN")
        if not db_url:
            raise ValueError(
                "Database URL not provided and DB_DSN environment variable not set"
            )

    # Fix for SQLAlchemy 2.0+: convert postgres:// to postgresql://
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)

    # Get Google API key for embeddings
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY environment variable not set")

    # Determine dimensions
    dimensions = EMBEDDING_DIMENSIONS.get(embedder_model)
    if not dimensions:
        logger.warning(
            "[KnowledgeFactory] Unknown dimensions for model '%s'. Defaulting to 768.",
            embedder_model,
        )
        dimensions = 768

    logger.info(
        "[KnowledgeFactory] Building PgVector + GeminiEmbedder (table=%s, model=%s, dim=%d)",
        table_name,
        embedder_model,
        dimensions,
    )

    # Create Gemini embedder
    embedder = GeminiEmbedder(
        id=embedder_model,  # Use 'id' parameter, not 'model'
        api_key=api_key,
        dimensions=dimensions,
    )

    # Create vector database with Gemini embedder
    try:
        # Create engine with connection pooling
        engine = create_engine(
            db_url, pool_size=10, max_overflow=20, pool_pre_ping=True
        )

        vector_db = PgVector(
            db_engine=engine,
            table_name=table_name,
            embedder=embedder,
        )
        return vector_db
    except Exception as e:
        error_msg = str(e)
        if "vector" in error_msg.lower() and "not available" in error_msg.lower():
            logger.error(
                "[KnowledgeFactory] PgVector extension not installed. "
                "Please run: CREATE EXTENSION IF NOT EXISTS vector; "
                "in your database. RAG features will be disabled."
            )
        raise


def _normalize_db_url(db_url: Optional[str]) -> str:
    """Get and normalize DB URL from env or argument."""
    if db_url is None:
        db_url = os.getenv("DB_DSN")
        if not db_url:
            raise ValueError(
                "Database URL not provided and DB_DSN environment variable not set"
            )
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    return db_url


def build_contents_db(
    db_url: Optional[str] = None,
    knowledge_table: str = DEFAULT_CONTENTS_TABLE,
) -> PostgresDb:
    """
    Build a PostgresDb instance for Knowledge contents tracking (Agno Contents DB).
    Used with Knowledge for content visibility and management.
    """
    db_url = _normalize_db_url(db_url)
    logger.info(
        "[KnowledgeFactory] Building Contents DB (knowledge_table=%s)",
        knowledge_table,
    )
    return PostgresDb(db_url=db_url, knowledge_table=knowledge_table)


def build_knowledge_base(
    db_url: Optional[str] = None,
    table_name: str = DEFAULT_TABLE_NAME,
    contents_table: str = DEFAULT_CONTENTS_TABLE,
    embedder_model: str = DEFAULT_EMBEDDER_MODEL,
    *,
    with_contents_db: bool = True,
) -> Knowledge:
    """
    Build a shared Knowledge instance with PgVector and optional Contents DB.
    User isolation is achieved by passing knowledge_filters={"user_id": ...} at run()
    and metadata={"user_id": ...} when calling insert/remove_vectors_by_metadata.
    """
    vector_db = build_vector_db(db_url, table_name, embedder_model)
    contents_db: Optional[PostgresDb] = None
    if with_contents_db:
        try:
            contents_db = build_contents_db(db_url, contents_table)
        except Exception as e:
            logger.warning(
                "[KnowledgeFactory] Contents DB not available, using vector_db only: %s",
                e,
            )

    knowledge = Knowledge(
        vector_db=vector_db,
        contents_db=contents_db,
        max_results=5,
    )

    logger.info(
        "[KnowledgeFactory] Knowledge created (contents_db=%s)",
        "yes" if contents_db else "no",
    )

    return knowledge
