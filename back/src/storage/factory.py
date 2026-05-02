from __future__ import annotations

from .backend import AgnoBackend, PayloadBackend, StorageBackend


def create_storage_backend(
    agent_storage_mode: str,
    chat_history: list[dict],
    session_id: str,
) -> StorageBackend:
    if agent_storage_mode == "agno":
        return AgnoBackend(session_id=session_id)
    return PayloadBackend(chat_history=chat_history)
