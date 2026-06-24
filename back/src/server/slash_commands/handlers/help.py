"""/help — list registered slash commands."""

from __future__ import annotations

from src.server.slash_commands.registry import (
    CommandSpec,
    SlashCommandContext,
    all_commands,
    register as _register,
)


async def handle(ctx: SlashCommandContext, args: str) -> None:
    lines = ["Available commands:"]
    for spec in all_commands():
        suffix = f" {spec.usage}" if spec.usage else ""
        lines.append(f"  /{spec.name}{suffix} — {spec.summary}")
    await ctx.send_text("\n".join(lines))


def register() -> None:
    _register(
        CommandSpec(
            name="help",
            summary="list commands",
            handler=handle,
        )
    )
