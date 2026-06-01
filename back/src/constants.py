"""Centralized constants for backend."""


class Redis:
    """Redis channel names and patterns."""

    CHANNEL_USER = "chat:user:{}"
    CHANNEL_REQUEST = "chat:request:{}"
    CHANNEL_STOP = "chat:stop:{}"
    CHANNEL_STORE_FACTS = "chat:store_facts"
    CHANNEL_JULES_MONITOR = "jules:monitor"
    # Per-session channel for client tool results (prevents cross-session delivery)
    # Format: chat:client_tool_result:{session_id}
    CHANNEL_CLIENT_TOOL_RESULT = "chat:client_tool_result:{}"
    # Results of deferred (queued) client actions drained by the device after the
    # originating brain run ended; consumed here to deliver a follow-up message.
    CHANNEL_DEFERRED_ACTION_RESULT = "chat:deferred_action_result"


class Polling:
    """Polling configuration for async tasks."""

    JULES_TIMEOUT_MINUTES = 30
    JULES_INTERVAL_SECONDS = 30
    JULES_CHECK_MINUTES = 1
