from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class StorageBackend(Protocol):
    def get_history(self) -> list[dict]:
        ...

    def use_agno_sessions(self) -> bool:
        ...


class PayloadBackend:
    """History arrives in the Go API payload; Agno does not manage sessions."""

    def __init__(self, chat_history: list[dict]) -> None:
        self._history = chat_history

    def get_history(self) -> list[dict]:
        return self._history

    def use_agno_sessions(self) -> bool:
        return False


class AgnoBackend:
    """Agno manages session history via PostgresDb using session_id.
    Go API omits chat_history from the payload; history is loaded from db."""

    def __init__(self, session_id: str) -> None:
        self._session_id = session_id

    def get_history(self) -> list[dict]:
        return []

    def use_agno_sessions(self) -> bool:
        return True
