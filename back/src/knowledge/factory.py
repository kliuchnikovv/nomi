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


def build_knowledge_base(
    db_url: Optional[str] = None,
    table_name: str = DEFAULT_TABLE_NAME,
    embedder_model: str = DEFAULT_EMBEDDER_MODEL,
) -> Knowledge:
    """
    Build a Knowledge instance with PgVector and GeminiEmbedder.
    
    Args:
        db_url: PostgreSQL connection URL. If None, reads from DB_DSN env var.
        table_name: Name of the table to store vectors (default: agent_knowledge).
        embedder_model: Gemini embedding model (default: models/text-embedding-004).
        
    Returns:
        Configured Knowledge instance.
        
    Raises:
        ValueError: If db_url is not provided and DB_DSN is not set.
        ValueError: If GOOGLE_API_KEY is not set.
    """
    # Get database URL from environment if not provided
    if db_url is None:
        db_url = os.getenv("DB_DSN")
        if not db_url:
            raise ValueError(
                "Database URL not provided and DB_DSN environment variable not set"
            )
    
    # Get Google API key for embeddings
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY environment variable not set")
    
    logger.info(
        "[KnowledgeFactory] Building Knowledge with PgVector + GeminiEmbedder (table=%s, model=%s)",
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
    vector_db = PgVector(
        db_url=db_url,
        table_name=table_name,
        embedder=embedder,
    )
    
    # Create knowledge base
    knowledge = Knowledge(
        vector_db=vector_db,
        max_results=5,  # Number of documents to return on search
    )
    
    logger.info("[KnowledgeFactory] Knowledge created successfully")
    
    return knowledge
