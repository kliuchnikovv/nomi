import logging
from typing import Any, Dict, List

from agno.knowledge import Knowledge
from agno.knowledge.document import Document
from agno.vectordb.pgvector import PgVector

logger = logging.getLogger(__name__)

class UserScopedKnowledge(Knowledge):
    """
    Knowledge Base wrapper that enforces user isolation using metadata filtering.
    """
    def __init__(self, user_id: str, vector_db: PgVector, max_results: int = 5):
        super().__init__(vector_db=vector_db)
        self.max_results = max_results
        self.user_id = user_id

    def search(self, query: str, max_results: int | None = None, filters: dict | None = None) -> List[Document]:
        """
        Search with enforced user_id filter.
        """
        effective_filter = (filters or {}).copy()
        # PgVector in Agno treats 'filters' as a metadata filter dictionary
        effective_filter["user_id"] = self.user_id
        logger.info(f"UserScopedKnowledge search: query='{query}', filters={effective_filter}")
        return super().search(query, max_results, filters=effective_filter)

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
                # Debug logging to identify the correct method signature
                # logger.info(f"Vector DB Type: {type(self.vector_db)}")
                # logger.info(f"Vector DB Dir: {dir(self.vector_db)}")

                # Try explicit load_documents if available on API, otherwise use upsert on vector_db
                if hasattr(self.vector_db, "upsert"):
                    # The error "missing 1 required positional argument: 'documents'" or 'content_hash'
                    # suggests differing signatures in versions.
                    # We try providing content_hash as None, and use kwargs to be safe.
                    try:
                        self.vector_db.upsert(documents=documents, content_hash=None)
                    except TypeError as te:
                         logger.warning(f"upsert(documents=..., content_hash=None) failed: {te}. Retrying with positional args.")
                         # Try pure positional: upsert(documents) or upsert(documents, content_hash)
                         try:
                             self.vector_db.upsert(documents)
                         except TypeError:
                             self.vector_db.upsert(documents, None)

                elif hasattr(self.vector_db, "add_documents"):
                    self.vector_db.add_documents(documents)
                else:
                    logger.warning("Could not find method to add documents to vector_db")
            except Exception as e:
                # Log detailed error to help debugging if it fails again
                logger.error(f"Failed to upsert documents: {e}", exc_info=True)
                raise e

    def delete(self, filters: Dict[str, Any] | None = None) -> None:
        """
        Delete documents with enforced user_id in metadata.
        """
        effective_filter = filters or {}
        effective_filter["user_id"] = self.user_id
        
        if self.vector_db:
            try:
                # Try explicit delete method suitable for metadata filtering
                if hasattr(self.vector_db, "delete_by_metadata"):
                     self.vector_db.delete_by_metadata(metadata=effective_filter)
                elif hasattr(self.vector_db, "delete_documents"):
                     # Some implementations might use delete_documents with filters
                     self.vector_db.delete_documents(filters=effective_filter)
                elif hasattr(self.vector_db, "delete"):
                     # Fallback to delete if it accepts filters (older versions might, but recent inspection showed it takes no args)
                     # Attempting to call with filters if signature allows, or log warning
                     import inspect
                     sig = inspect.signature(self.vector_db.delete)
                     if "filters" in sig.parameters:
                        self.vector_db.delete(filters=effective_filter)
                     elif "metadata" in sig.parameters:
                        self.vector_db.delete(metadata=effective_filter)
                     else:
                        logger.warning(f"PgVector.delete signature {sig} does not appear to support filters/metadata. Skipping delete.")
                else:
                    logger.warning("Could not find method to delete documents from vector_db")
            except Exception as e:
                logger.error(f"Failed to delete documents: {e}", exc_info=True)
                raise e
