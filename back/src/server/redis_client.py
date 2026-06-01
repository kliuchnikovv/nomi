"""Shared factory for resilient Redis clients.

Railway's internal network silently drops idle connections; redis-py only
notices on the next read, which surfaces as ``Timeout reading from ...``.
The settings below add proactive health checks, TCP keepalive, a bounded
connect timeout, and automatic retry on timeout so connections self-heal
instead of wedging the pub/sub workers.
"""
import redis.asyncio as redis

# Proactive PING interval (seconds) — detects dead sockets before a read does.
HEALTH_CHECK_INTERVAL = 30
# Bound the TCP connect so a reconnect attempt to an unreachable Redis cannot
# block the worker loop indefinitely.
SOCKET_CONNECT_TIMEOUT = 10


def make_redis_client(url: str) -> redis.Redis:
    """Create a Redis client configured for resilient long-lived connections."""
    return redis.from_url(
        url,
        decode_responses=True,
        health_check_interval=HEALTH_CHECK_INTERVAL,
        socket_keepalive=True,
        socket_connect_timeout=SOCKET_CONNECT_TIMEOUT,
        retry_on_timeout=True,
    )
