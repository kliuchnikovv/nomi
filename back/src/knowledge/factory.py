"""
Knowledge Base Factory for Agno Agentic RAG.

This module provides factory functions to create and configure:
- PgVector vector database using existing Postgres connection
- GeminiEmbedder for generating embeddings via Google Gemini API
- Knowledge base for RAG functionality
"""
import logging
import os
from typing import Optional

from agno.knowledge import Knowledge
from agno.vectordb.pgvector import PgVector
from agno.knowledge.embedder.google import GeminiEmbedder

logger = logging.getLogger(__name__)

# Default configuration
DEFAULT_TABLE_NAME = "agent_knowledge"
DEFAULT_EMBEDDER_MODEL = "text-embedding-004"  # Google's latest embedding model
DEFAULT_CHUNK_SIZE = 3000  # Good for code and documents
DEFAULT_CHUNK_OVERLAP = 300  # 10% overlap for context continuity



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
    
    logger.info(
        "[KnowledgeFactory] Building PgVector + GeminiEmbedder (table=%s, model=%s)",
        table_name,
        embedder_model,
    )
    
    # Create Gemini embedder
    embedder = GeminiEmbedder(
        id=embedder_model,  # Use 'id' parameter, not 'model'
        api_key=api_key,
        dimensions=768,  # Default for text-embedding-004
    )
    
    # Create vector database with Gemini embedder
    try:
        vector_db = PgVector(
            db_url=db_url,
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

def build_knowledge_base(
    db_url: Optional[str] = None,
    table_name: str = DEFAULT_TABLE_NAME,
    embedder_model: str = DEFAULT_EMBEDDER_MODEL,
) -> Knowledge:
    """
    Build a default Knowledge instance with PgVector and GeminiEmbedder.
    Note: This returns a global knowledge base without user isolation.
    Use UserScopedKnowledge with build_vector_db for multi-user support.
    """
    vector_db = build_vector_db(db_url, table_name, embedder_model)
    
    # Create knowledge base
    knowledge = Knowledge(
        vector_db=vector_db,
        max_results=5,  # Number of documents to return on search
    )
    
    logger.info("[KnowledgeFactory] Knowledge created successfully")
    
    return knowledge

