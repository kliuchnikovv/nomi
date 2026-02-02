"""Centralized constants for backend."""


class Redis:
    """Redis channel names and patterns."""

    CHANNEL_USER = "chat:user:{}"
    CHANNEL_REQUEST = "chat:request:{}"
    CHANNEL_STOP = "chat:stop:{}"
    CHANNEL_STORE_FACTS = "chat:store_facts"
    CHANNEL_JULES_MONITOR = "jules:monitor"
    CHANNEL_CLIENT_TOOL_RESULT = "chat:client_tool_result"


class Polling:
    """Polling configuration for async tasks."""

    JULES_TIMEOUT_MINUTES = 30
    JULES_INTERVAL_SECONDS = 30
    JULES_CHECK_MINUTES = 1
