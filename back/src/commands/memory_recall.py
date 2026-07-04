"""memory.recall command — semantic search over the user's saved notes/facts.

Companion to memory.note: where /note writes, /recall reads. Deterministic
RAG lookup (no agent in the loop), scoped to the calling user via filters.
Mirrors the search path in redis_session._extract_and_store_facts:
    knowledge.search(query=..., filters={"user_id": user_id}, num_documents=N)
"""
from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from src.commands.base import CommandResult, command
from src.commands.context import CommandContext

logger = logging.getLogger(__name__)


class MemoryRecallArgs(BaseModel):
    query: str = Field(..., min_length=1, description="What to look up in your memory")
    limit: int = Field(5, ge=1, le=20, description="Max number of results")


@command(
    name="memory.recall",
    title="Search your memory",
    description="Semantic search over notes and facts you've saved to long-term memory.",
    args_model=MemoryRecallArgs,
    requires=(),
    surface="chat",
)
async def memory_recall(args: MemoryRecallArgs, ctx: CommandContext) -> CommandResult:
    if ctx.knowledge is None:
        return CommandResult.error(
            code="NO_KNOWLEDGE",
            message="Knowledge base unavailable.",
        )
    try:
        hits = ctx.knowledge.search(
            query=args.query,
            filters={"user_id": ctx.user_id},
            max_results=args.limit,
        )
    except Exception:
        logger.exception("memory.recall search failed")
        return CommandResult.error(
            code="SEARCH_FAILED",
            message="Failed to search memory.",
        )

    contents = [
        (getattr(h, "content", "") or "").strip()
        for h in (hits or [])
    ]
    contents = [c for c in contents if c]
    if not contents:
        return CommandResult.ok(
            text=f'Nothing found in memory for "{args.query}".',
            data={"results": [], "count": 0},
        )

    body = "\n".join(f"• {c}" for c in contents)
    return CommandResult.ok(
        text=f'Found {len(contents)} for "{args.query}":\n{body}',
        data={"results": contents, "count": len(contents)},
    )
