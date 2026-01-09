from typing import List, Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)

from agno.knowledge import Knowledge
from agno.knowledge.document import Document
from agno.vectordb.pgvector import PgVector

class UserScopedKnowledge(Knowledge):
    """
    Knowledge Base wrapper that enforces user isolation using metadata filtering.
    """
    def __init__(self, user_id: str, vector_db: PgVector, num_documents: int = 5):
        super().__init__(vector_db=vector_db)
        self.num_documents = num_documents
        self.user_id = user_id

    def search(self, query: str, num_documents: int | None = None, filters: dict | None = None) -> List[Document]:
        """
        Search with enforced user_id filter.
        """
        effective_filter = filters or {}
        # PgVector in Agno treats 'filters' as a metadata filter dictionary
        effective_filter["user_id"] = self.user_id
        return super().search(query, num_documents, filters=effective_filter)

    def load_text(self, text: str, meta_data: dict = None):
        """
        Load text with enforced user_id in metadata.
        """
        meta_data = meta_data or {}
        meta_data["user_id"] = self.user_id
        
        doc = Document(content=text, meta_data=meta_data)
        self.load_documents([doc])
        
    def load_documents(self, documents: List[Document], upsert: bool = False):
        """
        Load documents with enforced user_id in metadata.
        """
        for doc in documents:
            if doc.meta_data is None:
                doc.meta_data = {}
            doc.meta_data["user_id"] = self.user_id
        if self.vector_db:
            try:
                # Try explicit load_documents if available on API, otherwise use upsert on vector_db
                # Agno/Phidata Knowledge might not have load_documents, so we try vector_db.upsert directly
                if hasattr(self.vector_db, "upsert"):
                    self.vector_db.upsert(documents)
                elif hasattr(self.vector_db, "add_documents"):
                    self.vector_db.add_documents(documents)
                else:
                    # Fallback or re-raise if we can't find a way to add
                    logger.warning("Could not find method to add documents to vector_db")
            except Exception as e:
                # If specifically AttributeError from 'super', we handled it by not calling super
                # But if vector_db call fails, we rely on standard error handling
                raise e
