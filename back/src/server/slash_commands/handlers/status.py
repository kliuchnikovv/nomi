"""/status — show current model, agent type, storage mode, and sticky flags."""

from __future__ import annotations

from src.server.slash_commands.registry import (
    CommandSpec,
    SlashCommandContext,
    register as _register,
)
from src.storage import chat_flags as _default_flags


async def handle(ctx: SlashCommandContext, args: str) -> None:
    flags_module = ctx.db_flags_module or _default_flags
    flags = await flags_module.get_flags(ctx.chat_id)

    payload = ctx.payload or {}
    model = payload.get("model") or "(default)"
    agent_type = payload.get("agent_type") or payload.get("type") or "nomi"

    lines = [
        "Status:",
        f"  model:        {model}",
        f"  agent_type:   {agent_type}",
        f"  storage_mode: {ctx.agent_storage_mode}",
    ]
    if flags:
        lines.append("  flags:")
        for k, v in sorted(flags.items()):
            # Truncate noisy values like compact_summary for the status block.
            display = v if not isinstance(v, str) or len(v) < 60 else v[:57] + "..."
            lines.append(f"    {k}: {display}")
    else:
        lines.append("  flags:        (none)")
    await ctx.send_text("\n".join(lines))


def register() -> None:
    _register(
        CommandSpec(
            name="status",
            summary="show model, agent type, storage mode, active flags",
            handler=handle,
        )
    )
