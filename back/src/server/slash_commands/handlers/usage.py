"""/usage — show token counts from the last completed agent run.

Reads ``usage:last:{user_id}`` written by ``RedisSession._capture_usage_metrics``
on every RunCompleted event. TTL is 1 hour — if it's missing we tell the user
there's nothing recent.
"""

from __future__ import annotations

import json
import time

from src.server.slash_commands.registry import (
    CommandSpec,
    SlashCommandContext,
    register as _register,
)


def _format_age(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds}s ago"
    if seconds < 3600:
        return f"{seconds // 60}m ago"
    return f"{seconds // 3600}h ago"


async def handle(ctx: SlashCommandContext, args: str) -> None:
    if not ctx.redis_client or not ctx.user_id:
        await ctx.send_text("No usage data available yet.")
        return

    raw = await ctx.redis_client.get(f"usage:last:{ctx.user_id}")
    if not raw:
        await ctx.send_text("No usage data available yet. Send a message first.")
        return

    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        await ctx.send_text("Usage data is corrupted; will be replaced next run.")
        return

    captured_at = int(data.get("captured_at") or 0)
    age = max(0, int(time.time()) - captured_at) if captured_at else 0

    lines = [
        "Last run:",
        f"  model:           {data.get('model') or '(unknown)'}",
        f"  input tokens:    {data.get('input_tokens', 0)}",
        f"  output tokens:   {data.get('output_tokens', 0)}",
        f"  total tokens:    {data.get('total_tokens', 0)}",
    ]
    reasoning = int(data.get("reasoning_tokens") or 0)
    if reasoning:
        lines.append(f"  reasoning tokens:{reasoning:>6}")
    cache_read = int(data.get("cache_read_tokens") or 0)
    if cache_read:
        lines.append(f"  cache read:      {cache_read}")
    cost = data.get("cost")
    if isinstance(cost, (int, float)) and cost > 0:
        lines.append(f"  cost (USD):      ${cost:.5f}")
    if captured_at:
        lines.append(f"  captured:        {_format_age(age)}")
    await ctx.send_text("\n".join(lines))


def register() -> None:
    _register(
        CommandSpec(
            name="usage",
            summary="show tokens used in the last run",
            handler=handle,
        )
    )
