from typing import List, Optional, Dict, Any
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

    def search(self, query: str, num_documents: int | None = None, filter: dict | None = None) -> List[Document]:
        """
        Search with enforced user_id filter.
        """
        effective_filter = filter or {}
        # PgVector in Agno treats 'filter' as a metadata filter dictionary
        effective_filter["user_id"] = self.user_id
        return super().search(query, num_documents, filter=effective_filter)

    def load_text(self, text: str, meta_data: dict = None):
        """
        Load text with enforced user_id in metadata.
        """
        meta_data = meta_data or {}
        meta_data["user_id"] = self.user_id
        super().load_text(text, meta_data)
        
    def load_documents(self, documents: List[Document], upsert: bool = False):
        """
        Load documents with enforced user_id in metadata.
        """
        for doc in documents:
            if doc.meta_data is None:
                doc.meta_data = {}
            doc.meta_data["user_id"] = self.user_id
        super().load_documents(documents, upsert)
