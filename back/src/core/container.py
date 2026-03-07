"""
Dependency Injection Container for Python backend.
Manages initialization and lifecycle of dependencies.
"""

import logging

from agno.db.postgres import PostgresDb
from agno.models.base import Model
from agno.knowledge.embedder.google import GeminiEmbedder

from src.agents.factory import AgentFactory
from src.tools.config import ToolConfigClient
from src.core.config import Config

logger = logging.getLogger(__name__)


class Container:
    """Dependency Injection Container for Python backend."""

    def __init__(
        self,
        config: Config,
    ):
        self.config = config

        # Core dependencies
        self._db: PostgresDb | None = None
        self._model: Model | None = None
        self._embedder: GeminiEmbedder | None = None
        self._config_client: ToolConfigClient | None = None

        # Lazy-initialized dependencies
        self._agent_factory: AgentFactory | None = None
        self._redis_worker = None
        self._knowledge = None

    @property
    def db(self) -> PostgresDb | None:
        """Get PostgresDb instance (lazy initialization)."""
        if self._db is None:
            self._db = self.config.get_db()
        return self._db

    @property
    def model(self) -> Model:
        """Get Model instance (lazy initialization)."""
        if self._model is None:
            self._model = self.config.get_model()
        return self._model

    @property
    def embedder(self) -> GeminiEmbedder:
        """Get Embedder instance (lazy initialization)."""
        if self._embedder is None:
            self._embedder = self.config.get_embedder()
        return self._embedder

    @property
    def config_client(self) -> ToolConfigClient:
        """Get ToolConfigClient instance (lazy initialization)."""
        if self._config_client is None:
            self._config_client = self.config.get_tool_config_client()
        return self._config_client

    @property
    def knowledge(self):
        """Get shared Agno Knowledge instance (lazy initialization)."""
        if self._knowledge is None:
            from agno.knowledge import Knowledge
            from agno.vectordb.pgvector import PgVector

            db_url = self.config.db_dsn or ""
            if db_url.startswith("postgres://"):
                db_url = db_url.replace("postgres://", "postgresql://", 1)

            vector_db = PgVector(
                table_name="personal_vectors",
                db_url=db_url,
                embedder=self.embedder,
            )
            self._knowledge = Knowledge(vector_db=vector_db)
            logger.info("[Container] Knowledge initialized")
        return self._knowledge

    @property
    def agent_factory(self) -> AgentFactory:
        """Get AgentFactory instance (lazy initialization)."""
        if self._agent_factory is None:
            from src.agents.factory import AgentFactory

            self._agent_factory = AgentFactory(
                db=self.db,
                model=self.model,
                config_client=self.config_client,
                debug_mode=self.config.debug_mode,
                knowledge=self.knowledge,
            )
            logger.info("[Container] AgentFactory initialized")
        return self._agent_factory

    @property
    def redis_worker(self):
        """Get RedisWorker instance (lazy initialization)."""
        if self._redis_worker is None:
            from src.server.redis_worker import RedisWorker

            self._redis_worker = RedisWorker(self.agent_factory)
            logger.info("[Container] RedisWorker initialized")
        return self._redis_worker

    async def close(self):
        """Cleanup resources."""
        if self._config_client:
            await self.config_client.close()
        logger.info("[Container] Resources closed")
