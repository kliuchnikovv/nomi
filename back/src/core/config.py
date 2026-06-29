"""
Configuration management for Python backend.
Loads configuration from environment variables.
"""

import os

from agno.db.postgres import PostgresDb
from agno.knowledge.embedder.google import GeminiEmbedder
from src.core.gemini_keys import KEY_MANAGER
from src.models.safe_gemini import SafeGemini
from src.tools.config import ToolConfigClient

# Dedicated model for memory/learning extraction and recap/compaction. Decoupled
# from the user-selected chat model so memory quality is stable regardless of the
# chat model, and to avoid GLM's structured-output/tool-call unreliability on the
# extraction path. Overridable via the MEMORY_MODEL env var.
DEFAULT_MEMORY_MODEL = "gemini-2.5-flash"


class Config:
    """Configuration class for Python backend."""

    def __init__(self):
        self.debug_mode = os.getenv("DEBUG") == "True"
        self.google_api_key = os.getenv("GOOGLE_API_KEY")
        self.db_dsn = os.getenv("DB_DSN")
        self.go_api_url = os.getenv("GO_API_URL", "http://localhost:8080")
        self.session_secret = os.getenv(
            "SESSION_SECRET", "dev-session-secret-change-me"
        )
        # Dedicated model id used for memory extraction, learning, and recap.
        self.memory_model_name = os.getenv("MEMORY_MODEL", DEFAULT_MEMORY_MODEL)

    @classmethod
    def from_env(cls) -> "Config":
        """Create Config instance from environment variables."""
        return cls()

    def get_db(self) -> PostgresDb | None:
        """Get PostgresDb instance if DB_DSN is configured."""
        if not self.db_dsn:
            return None

        # Fix for SQLAlchemy 2.0+: convert postgres:// to postgresql://
        if self.db_dsn.startswith("postgres://"):
            self.db_dsn = self.db_dsn.replace("postgres://", "postgresql://", 1)

        return PostgresDb(self.db_dsn)

    def get_model(self) -> SafeGemini:
        """Get Gemini model instance (key from the rotating pool)."""
        return SafeGemini(
            id="gemini-2.5-flash-lite",
            api_key=KEY_MANAGER.current(),
        )

    def get_embedder(self) -> GeminiEmbedder:
        """Get Gemini embedder instance (key from the rotating pool)."""
        return GeminiEmbedder(
            id="gemini-embedding-001",
            api_key=KEY_MANAGER.current(),
            dimensions=768,
        )

    def get_tool_config_client(self) -> ToolConfigClient:
        """Get ToolConfigClient instance."""
        return ToolConfigClient(self.go_api_url)
