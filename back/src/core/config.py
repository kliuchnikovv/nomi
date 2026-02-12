"""
Configuration management for Python backend.
Loads configuration from environment variables.
"""

import os

from agno.db.postgres import PostgresDb
from agno.models.google import Gemini
from agno.knowledge.embedder.google import GeminiEmbedder
from src.tools.config import ToolConfigClient


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

    def get_model(self) -> Gemini:
        """Get Gemini model instance."""
        if not self.google_api_key:
            raise ValueError("GOOGLE_API_KEY environment variable not set")

        return Gemini(
            id="gemini-2.0-flash",
            api_key=self.google_api_key,
        )

    def get_embedder(self) -> GeminiEmbedder:
        """Get Gemini embedder instance."""
        if not self.google_api_key:
            raise ValueError("GOOGLE_API_KEY environment variable not set")

        return GeminiEmbedder(
            id="models/text-embedding-004",
            api_key=self.google_api_key,
            dimensions=768,
        )

    def get_tool_config_client(self) -> ToolConfigClient:
        """Get ToolConfigClient instance."""
        return ToolConfigClient(self.go_api_url)
