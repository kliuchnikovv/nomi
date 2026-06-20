"""memory.note command — inserts a free-form note into the shared Agno Knowledge store.

Mirrors the canonical write path used in _extract_and_store_facts (redis_session.py):
    knowledge.insert(text_content=..., metadata={"user_id": user_id})
"""
from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from src.commands.base import CommandResult, command
from src.commands.context import CommandContext

logger = logging.getLogger(__name__)


class MemoryNoteArgs(BaseModel):
    text: str = Field(..., min_length=1, description="Free-form note to remember")
    tags: list[str] = Field(default_factory=list, description="Optional tags")


@command(
    name="memory.note",
    title="Save note to memory",
    description="Insert a free-form note into your long-term memory.",
    args_model=MemoryNoteArgs,
    requires=(),
    surface="chat",
)
async def memory_note(args: MemoryNoteArgs, ctx: CommandContext) -> CommandResult:
    if ctx.knowledge is None:
        return CommandResult.error(
            code="NO_KNOWLEDGE",
            message="Knowledge base unavailable.",
        )
    try:
        ctx.knowledge.insert(
            text_content=args.text,
            metadata={
                "user_id": ctx.user_id,
                "tags": args.tags,
                "source": "command:memory.note",
            },
        )
    except Exception:
        logger.exception("memory.note insert failed")
        return CommandResult.error(
            code="INSERT_FAILED",
            message="Failed to save note.",
        )
    return CommandResult.ok(
        text="Note saved.",
        data={"chars": len(args.text)},
    )
