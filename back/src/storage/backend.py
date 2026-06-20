from __future__ import annotations


class AgnoBackend:
    """Agno manages session history via PostgresDb using session_id."""

    def __init__(self, session_id: str) -> None:
        self._session_id = session_id

    @property
    def session_id(self) -> str:
        return self._session_id
