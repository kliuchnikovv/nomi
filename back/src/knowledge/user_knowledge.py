import logging
from typing import Any, Dict, List

from agno.knowledge import Knowledge
from agno.knowledge.document import Document
from agno.vectordb.pgvector import PgVector

logger = logging.getLogger(__name__)

# Minimum cosine similarity (0..1) to consider a document relevant. Below this, results are
# filtered out so the agent does not receive unrelated docs (e.g. Genie README for "эффект Долины").
# Higher value (0.6) reduces irrelevant facts in responses (e.g. no "you love chebureki" on "Hi!").
DEFAULT_MIN_SIMILARITY_THRESHOLD = 0.6


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    """Compute cosine similarity between two vectors. Result in [-1, 1]; we clamp to [0, 1] for thresholding."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    sim = dot / (norm_a * norm_b)
    return max(0.0, min(1.0, sim))


class UserScopedKnowledge(Knowledge):
    """
    Knowledge Base wrapper that enforces user isolation using metadata filtering.
    Optionally filters out low-relevance results so the agent does not receive unrelated documents.
    """
    def __init__(
        self,
        user_id: str,
        vector_db: PgVector,
        max_results: int = 5,
        min_similarity_threshold: float | None = DEFAULT_MIN_SIMILARITY_THRESHOLD,
    ):
        super().__init__(vector_db=vector_db)
        self.max_results = max_results
        self.user_id = user_id
        self.min_similarity_threshold = min_similarity_threshold

    def search(self, query: str, max_results: int | None = None, filters: dict | None = None) -> List[Document]:
        """
        Search with enforced user_id filter and optional minimum relevance threshold.
        Documents below min_similarity_threshold are excluded so the agent does not
        get unrelated results (e.g. project README when the user asks about something else).
        """
        effective_filter = (filters or {}).copy()
        effective_filter["user_id"] = self.user_id
        logger.info(
            "[RAG Search] user_id=%s query=%r max_results=%s filters=%s",
            self.user_id,
            query,
            max_results or self.max_results,
            effective_filter,
        )

        raw = super().search(query, max_results, filters=effective_filter)
        logger.info("[RAG Search] Found %d raw results from vector DB", len(raw) if raw else 0)
        
        if not raw or self.min_similarity_threshold is None:
            if not raw:
                logger.info("[RAG Search] No results found in knowledge base")
            else:
                logger.info("[RAG Search] Returning %d results (no similarity filtering)", len(raw))
            return raw

        # Filter by relevance: require query embedding and document embeddings
        embedder = getattr(self.vector_db, "embedder", None)
        if not embedder or not hasattr(embedder, "get_embedding"):
            logger.warning("[RAG Search] No embedder available, returning raw results")
            return raw
        
        query_embedding = embedder.get_embedding(query)
        if not query_embedding:
            logger.warning("[RAG Search] Failed to get query embedding, returning raw results")
            return raw

        filtered: List[Document] = []
        for doc in raw:
            emb = getattr(doc, "embedding", None)
            doc_id = getattr(doc, "id", None)
            doc_content = getattr(doc, "content", "")
            doc_preview = doc_content[:100] if doc_content else "(empty)"
            
            if emb is None:
                logger.debug("[RAG Search] Document id=%s has no embedding, including by default", doc_id)
                filtered.append(doc)
                continue
            
            sim = _cosine_similarity(query_embedding, emb)
            if sim >= self.min_similarity_threshold:
                logger.info(
                    "[RAG Search] ✓ Relevant document: id=%s similarity=%.3f content_preview=%r",
                    doc_id,
                    sim,
                    doc_preview,
                )
                filtered.append(doc)
            else:
                logger.info(
                    "[RAG Search] ✗ Filtered low-relevance document: id=%s similarity=%.3f (threshold=%.3f) content_preview=%r",
                    doc_id,
                    sim,
                    self.min_similarity_threshold,
                    doc_preview,
                )
        
        logger.info(
            "[RAG Search] Relevance filtering complete: %d/%d documents passed (threshold=%.2f)",
            len(filtered),
            len(raw),
            self.min_similarity_threshold,
        )
        return filtered

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
        logger.info(
            "[RAG Store] Storing %d document(s) for user_id=%s",
            len(documents),
            self.user_id,
        )
        
        for idx, doc in enumerate(documents):
            if doc.meta_data is None:
                doc.meta_data = {}
            doc.meta_data["user_id"] = self.user_id
            
            # Log document content being stored
            doc_content = getattr(doc, "content", "")
            doc_preview = doc_content[:200] if doc_content else "(empty)"
            logger.info(
                "[RAG Store] Document %d/%d: content_preview=%r metadata=%s",
                idx + 1,
                len(documents),
                doc_preview,
                doc.meta_data,
            )
        
        if self.vector_db:
            try:
                # Try explicit load_documents if available on API, otherwise use upsert on vector_db
                if hasattr(self.vector_db, "upsert"):
                    # The error "missing 1 required positional argument: 'documents'" or 'content_hash'
                    # suggests differing signatures in versions.
                    # We try providing content_hash as None, and use kwargs to be safe.
                    try:
                        self.vector_db.upsert(documents=documents, content_hash=None)
                        logger.info("[RAG Store] Successfully stored %d document(s) via upsert", len(documents))
                    except TypeError as te:
                         logger.warning(f"[RAG Store] upsert(documents=..., content_hash=None) failed: {te}. Retrying with positional args.")
                         # Try pure positional: upsert(documents) or upsert(documents, content_hash)
                         try:
                             self.vector_db.upsert(documents)
                             logger.info("[RAG Store] Successfully stored %d document(s) via upsert (positional)", len(documents))
                         except TypeError:
                             self.vector_db.upsert(documents, None)
                             logger.info("[RAG Store] Successfully stored %d document(s) via upsert (positional with None)", len(documents))

                elif hasattr(self.vector_db, "add_documents"):
                    self.vector_db.add_documents(documents)
                    logger.info("[RAG Store] Successfully stored %d document(s) via add_documents", len(documents))
                else:
                    logger.warning("[RAG Store] Could not find method to add documents to vector_db")
            except Exception as e:
                # Log detailed error to help debugging if it fails again
                logger.error(f"[RAG Store] Failed to store documents: {e}", exc_info=True)
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
