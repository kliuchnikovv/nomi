"""
Thin adapter that injects user_id into insert/insert_many so Agno update_knowledge
stores facts with user isolation. Search isolation is handled by knowledge_filters at run().
"""

import logging
from functools import lru_cache
from typing import Any, Dict, List

from agno.knowledge import Knowledge
from agno.knowledge.document import Document
from agno.vectordb.pgvector import PgVector

logger = logging.getLogger(__name__)


class UserKnowledgeAdapter:
    """
    Wraps a shared Knowledge and injects user_id into metadata on insert/insert_many.
    Used when passing knowledge to agents so that update_knowledge stores with user_id.
    Search is scoped via knowledge_filters at agent.run() / arun(), not here.
    """

    def __init__(self, knowledge: Knowledge, user_id: str):
        self._knowledge = knowledge
        self._user_id = user_id

    def insert(self, **kwargs) -> None:
        meta = dict(kwargs.get("metadata") or {})
        meta["user_id"] = self._user_id
        kwargs["metadata"] = meta
        return self._knowledge.insert(**kwargs)

    def insert_many(self, items: list, **kwargs) -> None:
        # Ensure each item's metadata includes user_id
        for item in items:
            if isinstance(item, dict):
                item.setdefault("metadata", {})
                item["metadata"]["user_id"] = self._user_id
        return self._knowledge.insert_many(items, **kwargs)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._knowledge, name)


# --- Legacy UserScopedKnowledge (used by test_rag_logging; optional for backward compat) ---
# Minimum cosine similarity (0..1) to consider a document relevant. Below this, results are
# filtered out so the agent does not receive unrelated docs (e.g. Genie README for "эффект Долины").
# Higher value (0.6) reduces irrelevant facts in responses (e.g. no "you love chebureki" on "Hi!").
DEFAULT_MIN_SIMILARITY_THRESHOLD = 0.6


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    """Compute cosine similarity between two vectors. Result in [-1, 1]; we clamp to [0, 1] for thresholding.
    Accepts lists or numpy-like arrays; avoids 'truth value of array is ambiguous' by not using bool(arr).
    """
    if a is None or b is None or len(a) == 0 or len(b) == 0 or len(a) != len(b):
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

        # Optimization: Apply LRU cache to embedder to avoid double API calls
        # (once in PgVector.search and once in our filter)
        # This modifies the shared embedder instance, acting as a global cache.
        embedder = getattr(vector_db, "embedder", None)
        if embedder and hasattr(embedder, "get_embedding"):
            # Check if already wrapped to avoid infinite wrapping recursion
            if not hasattr(embedder.get_embedding, "cache_info"):
                original_method = embedder.get_embedding

                @lru_cache(maxsize=128)
                def cached_get_embedding(text):
                    return original_method(text)

                embedder.get_embedding = cached_get_embedding
                logger.debug("[UserKnowledge] Applied LRU cache to shared embedder")

    def search(
        self,
        query: str,
        max_results: int | None = None,
        filters: Dict[str, Any] | List[Any] | None = None,
        search_type: str | None = None,
    ) -> List[Document]:
        """
        Search with enforced user_id filter and optional minimum relevance threshold.
        Documents below min_similarity_threshold are excluded so the agent does not
        get unrelated results (e.g. project README when the user asks about something else).
        """
        effective_filter: Dict[str, Any] = {}
        if filters is None:
            effective_filter = {}
        elif isinstance(filters, dict):
            effective_filter = filters.copy()
        else:
            # TODO: Support List[FilterExpr] by appending EQ("user_id", self.user_id)
            logger.warning(
                "UserScopedKnowledge: List filters not supported yet, ignoring provided filters to enforce user isolation."
            )
            effective_filter = {}

        effective_filter["user_id"] = self.user_id
        logger.info(
            "[RAG Search] user_id=%s query=%r max_results=%s filters=%s",
            self.user_id,
            query,
            max_results or self.max_results,
            effective_filter,
        )

        # Optimization: Cache embedding generation to avoid double API calls
        # (once in super().search() -> PgVector.search(), and once here for filtering)
        embedder = getattr(self.vector_db, "embedder", None)
        query_embedding = None

        # We rely on the LRU cache applied in __init__ to make this cheap
        raw = super().search(
            query, max_results, filters=effective_filter, search_type=search_type
        )

        if embedder and hasattr(embedder, "get_embedding"):
            query_embedding = embedder.get_embedding(query)
        else:
            logger.warning("[RAG Search] No embedder available")

        logger.info(
            "[RAG Search] Found %d raw results from vector DB", len(raw) if raw else 0
        )

        if not raw or self.min_similarity_threshold is None:
            if not raw:
                logger.info("[RAG Search] No results found in knowledge base")
            else:
                logger.info(
                    "[RAG Search] Returning %d results (no similarity filtering)",
                    len(raw),
                )
            return raw

        # Filter by relevance: require query embedding and document embeddings
        if query_embedding is None or (
            hasattr(query_embedding, "__len__") and len(query_embedding) == 0
        ):
            logger.warning(
                "[RAG Search] Failed to get query embedding, returning raw results"
            )
            return raw

        filtered: List[Document] = []
        for doc in raw:
            emb = getattr(doc, "embedding", None)
            doc_id = getattr(doc, "id", None)
            doc_content = getattr(doc, "content", "")
            doc_preview = doc_content[:100] if doc_content else "(empty)"

            if emb is None:
                # If embedding is missing, try to generate it to ensure filtering works
                logger.debug(
                    "[RAG Search] Document id=%s has no embedding, attempting to generate",
                    doc_id,
                )
                try:
                    doc.embed(embedder=embedder)
                    emb = doc.embedding
                except Exception as e:
                    logger.warning(
                        "[RAG Search] Failed to generate embedding for doc %s: %s",
                        doc_id,
                        e,
                    )

            if emb is None:
                logger.warning(
                    "[RAG Search] Document id=%s still has no embedding, excluding from results (strict filtering)",
                    doc_id,
                )
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

    def load_text(self, text: str, meta_data: Dict[str, Any] | None = None):
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

        if not self.vector_db:
            return
            
        try:
            # Use concrete signatures for Agno's PgVector
            if upsert:
                # upsert(content_hash, documents, ...)
                if hasattr(self.vector_db, "upsert"):
                    # We pass empty content_hash as UserScopedKnowledge manages general docs
                    self.vector_db.upsert(content_hash="", documents=documents)
                    logger.info(
                        "[RAG Store] Successfully stored %d document(s) via upsert",
                        len(documents),
                    )
                else:
                    logger.warning("[RAG Store] vector_db does not support upsert")
            else:
                # insert(content_hash, documents, ...)
                if hasattr(self.vector_db, "insert"):
                    self.vector_db.insert(content_hash="", documents=documents)
                    logger.info(
                        "[RAG Store] Successfully stored %d document(s) via insert",
                        len(documents),
                    )
                elif hasattr(self.vector_db, "add_documents"):
                    # Fallback for generic VectorDb
                    self.vector_db.add_documents(documents)
                    logger.info(
                        "[RAG Store] Successfully stored %d document(s) via add_documents",
                        len(documents),
                    )
                else:
                    logger.warning(
                        "[RAG Store] Could not find method to add documents to vector_db"
                    )
        except Exception as e:
            # Log detailed error to help debugging if it fails again
            logger.error(
                f"[RAG Store] Failed to store documents: {e}", exc_info=True
            )
            raise e

    def delete(self, filters: Dict[str, Any] | None = None) -> None:
        """
        Delete documents with enforced user_id in metadata.
        """
        effective_filter = filters or {}
        effective_filter["user_id"] = self.user_id

        if not self.vector_db:
            return

        try:
            # Use standard delete_by_metadata method
            if hasattr(self.vector_db, "delete_by_metadata"):
                self.vector_db.delete_by_metadata(metadata=effective_filter)
                logger.info(
                    "[RAG Delete] Deleted documents with filters: %s",
                    effective_filter,
                )
            elif hasattr(self.vector_db, "delete_documents"):
                self.vector_db.delete_documents(filters=effective_filter)
            elif hasattr(self.vector_db, "delete"):
                # Fallback if specific method missing, but avoid runtime inspection
                logger.warning(
                    "[RAG Delete] Falling back to generic delete(), hope it supports filters"
                )
                self.vector_db.delete(filters=effective_filter)
            else:
                logger.warning(
                    "Could not find method to delete documents from vector_db"
                )
        except Exception as e:
            logger.error(f"Failed to delete documents: {e}", exc_info=True)
            raise e
