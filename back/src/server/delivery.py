"""
Generic delivery channel abstraction for plugins.

Plugins register a DeliveryHandler keyed by source name (e.g. "telegram").
RedisSession uses the registry to deliver completed AI responses to external channels
without knowing plugin-specific details.
"""

import logging
from typing import Any, Optional, Protocol

logger = logging.getLogger(__name__)


class DeliveryHandler(Protocol):
    """Protocol that plugins implement to receive completed AI responses."""

    async def deliver(self, text: str, context: dict[str, Any]) -> None:
        """Deliver the completed response text to the external channel."""
        ...

    def should_buffer(self) -> bool:
        """Whether this handler needs text chunks to be buffered before delivery."""
        ...


class DeliveryRegistry:
    """Registry of delivery handlers keyed by source name."""

    _handlers: dict[str, DeliveryHandler] = {}

    @classmethod
    def register(cls, source: str, handler: DeliveryHandler) -> None:
        cls._handlers[source] = handler
        logger.info("Registered delivery handler for source: %s", source)

    @classmethod
    def get(cls, source: str) -> Optional[DeliveryHandler]:
        return cls._handlers.get(source)
