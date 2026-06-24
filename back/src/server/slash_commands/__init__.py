"""User-typed slash commands (``/help``, ``/status`` …).

These intercept the user message **before** the agent runs — no LLM tokens are
spent, behavior is deterministic. Distinct from ``src.commands.*`` (agent-
callable Command system, fired via ``Op.COMMAND_CALL``).

Entry point: :func:`dispatch`. Wire it in
``src.server.redis_session.RedisSession.handle_user_message`` between delivery-
context extraction and ``build_agent_instance``.
"""

from src.server.slash_commands.registry import dispatch, SlashCommandContext

__all__ = ["dispatch", "SlashCommandContext"]
