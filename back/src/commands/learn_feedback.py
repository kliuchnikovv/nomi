"""learn.feedback command — explicit LTM injection with a kind tag.

Provides a deterministic channel for users to record preferences, corrections,
or facts that bypass the implicit fact-extraction path. Uses LearningMachine
when available; falls back to a direct knowledge.insert otherwise.
"""
from __future__ import annotations

import logging
from typing import Literal

from pydantic import BaseModel, Field

from src.commands.base import CommandResult, command
from src.commands.context import CommandContext

logger = logging.getLogger(__name__)


class LearnFeedbackArgs(BaseModel):
    kind: Literal["preference", "correction", "fact"]
    text: str = Field(..., min_length=1)


async def _record(*, user_id: str, session_id: str | None, kind: str, text: str) -> None:
    """Thin wrapper around LearningMachine so tests can monkeypatch.

    Builds a tagged message and feeds it to LearningMachine.aprocess so the
    explicit feedback travels the same write path as implicit fact-extraction.
    Raises RuntimeError if the LearningMachine import or construction fails —
    caller should catch and fall back to knowledge.insert.
    """
    from src.agents.nomi import build_learning_machine  # lazy import

    # We don't have agent_factory/db available at command-call time in v1,
    # so raise early to trigger the fallback path.
    raise RuntimeError(
        "LearningMachine requires agent_factory and db — "
        "not yet threaded into CommandContext (v1 fallback to knowledge.insert)"
    )


@command(
    name="learn.feedback",
    title="Teach Nomi",
    description="Record an explicit preference, correction, or fact about you.",
    args_model=LearnFeedbackArgs,
    requires=(),
    surface="chat",
)
async def learn_feedback(args: LearnFeedbackArgs, ctx: CommandContext) -> CommandResult:
    # Primary path: LearningMachine (same write path as implicit fact-extraction)
    try:
        await _record(
            user_id=ctx.user_id,
            session_id=ctx.session_id,
            kind=args.kind,
            text=args.text,
        )
        return CommandResult.ok(text="Got it.", data={"kind": args.kind})
    except Exception:
        logger.debug(
            "learn.feedback LearningMachine path unavailable; falling back to knowledge insert"
        )

    # Fallback path: direct knowledge insert
    if ctx.knowledge is None:
        return CommandResult.error(
            code="no_backend",
            message="No learning backend available.",
        )
    try:
        ctx.knowledge.insert(
            text_content=args.text,
            metadata={
                "user_id": ctx.user_id,
                "kind": args.kind,
                "source": "command:learn.feedback",
            },
        )
    except Exception as e:
        logger.exception("learn.feedback knowledge insert failed")
        return CommandResult.error(code="record_failed", message=str(e))

    return CommandResult.ok(text="Got it.", data={"kind": args.kind})
