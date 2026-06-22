"""web.search command — deterministic web search via DuckDuckGo, no agent.

Resolves the always-available `web_search` toolkit (no credentials needed) and
returns the raw search results. The toolkit method is synchronous and does
blocking HTTP, so it runs in a worker thread to avoid stalling the event loop.
"""
from __future__ import annotations

import asyncio
import logging

from pydantic import BaseModel, Field

from src.commands.base import CommandResult, command
from src.commands.context import CommandContext

logger = logging.getLogger(__name__)


class WebSearchArgs(BaseModel):
    query: str = Field(..., min_length=1, description="What to search the web for")
    limit: int = Field(5, ge=1, le=10, description="Max number of results")


@command(
    name="web.search",
    title="Search the web",
    description="Search the web (DuckDuckGo) and return results directly, without the agent.",
    args_model=WebSearchArgs,
    requires=(),
    surface="chat",
)
async def web_search(args: WebSearchArgs, ctx: CommandContext) -> CommandResult:
    tk = await ctx.toolkit("web_search")
    if tk is None:
        return CommandResult.error(
            code="WEB_SEARCH_UNAVAILABLE",
            message="Web search is not available.",
        )
    try:
        results = await asyncio.to_thread(
            tk.duckduckgo_search, args.query, max_results=args.limit
        )
    except Exception:
        logger.exception("web.search failed")
        return CommandResult.error(
            code="SEARCH_FAILED",
            message="Web search failed.",
        )

    text = (results or "").strip() if isinstance(results, str) else str(results)
    if not text:
        return CommandResult.ok(
            text=f'No web results for "{args.query}".',
            data={"results": "", "query": args.query},
        )
    return CommandResult.ok(
        text=text,
        data={"results": text, "query": args.query},
    )
