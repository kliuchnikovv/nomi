"""Helpers for interacting with a remote LightRAG deployment.

The local API layer only proxies CRUD operations to the LightRAG server:
* POST /documents/text             — store text chunks
* GET  /documents/track_status/:id — poll ingestion status
* POST /query                      — run hybrid/local/global queries
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx
from lightrag.core import Component


DEFAULT_BASE_URL = os.getenv("LIGHTRAG_BASE_URL") or os.getenv("LIGHTRAG_ENDPOINT") or "http://localhost:9621"
DEFAULT_MODE = os.getenv("LIGHTRAG_QUERY_MODE", "hybrid")
LIGHTRAG_API_KEY = os.getenv("LIGHTRAG_API_KEY")
AUTH_HEADER_NAME = os.getenv("LIGHTRAG_AUTH_HEADER", "X-API-KEY")
AUTH_HEADER_FORMAT = os.getenv("LIGHTRAG_AUTH_TEMPLATE", "{api_key}")
TRACK_TIMEOUT = float(os.getenv("LIGHTRAG_TRACK_TIMEOUT", "30"))
TRACK_POLL_INTERVAL = float(os.getenv("LIGHTRAG_TRACK_POLL_INTERVAL", "1.0"))


def _build_headers(json: bool = True) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    if json:
        headers["Content-Type"] = "application/json"
    if LIGHTRAG_API_KEY:
        headers[AUTH_HEADER_NAME] = AUTH_HEADER_FORMAT.format(api_key=LIGHTRAG_API_KEY)
    return headers


@dataclass
class RAGCallResult:
    """Compatibility wrapper that mimics previous RAG pipeline responses."""

    data: str
    raw: Any


class RemoteLightRAG(Component):
    """Minimal pipeline that proxies operations to an external LightRAG server."""

    def __init__(self, base_url: str = DEFAULT_BASE_URL, mode: str = DEFAULT_MODE):
        super().__init__()
        self.base_url = base_url.rstrip("/")
        self.mode = mode

    def _post(self, path: str, *, json: Optional[Dict[str, Any]] = None) -> httpx.Response:
        url = f"{self.base_url}{path}"
        response = httpx.post(url, json=json, headers=_build_headers())
        response.raise_for_status()
        return response

    def _get(self, path: str) -> httpx.Response:
        url = f"{self.base_url}{path}"
        response = httpx.get(url, headers=_build_headers(json=False))
        response.raise_for_status()
        return response

    def _wait_for_track(self, track_id: str) -> Optional[str]:
        """Poll LightRAG until the asynchronous ingestion job completes."""
        if not track_id:
            return None

        deadline = time.monotonic() + TRACK_TIMEOUT
        while time.monotonic() < deadline:
            status = self._get(f"/documents/track_status/{track_id}").json()
            documents = status.get("documents") or []
            if documents:
                return documents[0].get("id")
            time.sleep(TRACK_POLL_INTERVAL)
        return None

    def index(self, documents: List[Dict[str, Any]]) -> None:
        for doc in documents:
            payload: Dict[str, Any] = {
                "text": doc.get("text", ""),
                "file_source": doc.get("id"),
            }
            metadata = doc.get("metadata")
            if metadata:
                payload["metadata"] = metadata

            if not payload["text"]:
                continue

            track_info = self._post("/documents/text", json=payload).json()
            track_id = track_info.get("track_id")
            self._wait_for_track(track_id)

    def call(self, query: str, *, mode: Optional[str] = None) -> RAGCallResult:
        payload = {"query": query, "mode": mode or self.mode}
        response = self._post("/query", json=payload).json()

        if isinstance(response, dict):
            answer = response.get("response") or response.get("data")
            if isinstance(answer, str):
                return RAGCallResult(data=answer, raw=response)
            return RAGCallResult(data=str(response), raw=response)
        if isinstance(response, list) and response:
            # Server sometimes returns a list of objects; join their textual parts.
            sections = []
            for item in response:
                if isinstance(item, str):
                    sections.append(item)
                elif isinstance(item, dict):
                    sections.append(item.get("response") or item.get("content") or str(item))
            data = "\n\n".join(sections) if sections else str(response)
            return RAGCallResult(data=data, raw=response)
        return RAGCallResult(data=str(response), raw=response)


rag_pipeline = RemoteLightRAG()


def index_document(document_id: str, text: str, metadata: Dict[str, Any] | None) -> None:
    """Send a single document to LightRAG for indexing."""
    doc = {"id": document_id, "text": text, "metadata": metadata or {}}
    rag_pipeline.index([doc])


def query_rag(user_query: str) -> str:
    """Proxy the question to LightRAG and return the model response."""
    result = rag_pipeline.call(user_query)
    return result.data
