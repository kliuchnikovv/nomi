from typing import Sequence

from agno.agent import Agent
from agno.models.base import Model
from agno.db.postgres import PostgresDb
from agno.tools import Toolkit, Function

class MemoriserAgent(Agent):
    """Agent that extracts memorable facts from user messages.

    It runs a lightweight LLM (provided as a tool or the default model) with a fixed prompt
    and stores the returned cards in the `memory` table.
    """

    MEMORY_PROMPT = (
        "You receive the last N user replies and a task description. "
        "Extract 0‑3 facts/preferences/goals that should be remembered long‑term. "
        "If nothing is important, return an empty list."
    )

    def __init__(self, *, db: PostgresDb | None, model: Model, tools: Sequence[Toolkit | Function] | None = None, debug_mode: bool = False):
        super().__init__(
            db=db,
            name="Memoriser",
            model=model,
            tools=tools,
            description="Extracts memory cards from user messages.",
            add_history_to_context=False,
            add_datetime_to_context=False,
            debug_mode=debug_mode,
            read_tool_call_history=True,  # Enable reading tool call history
            store_tool_messages=True,  # Store tool call results
            read_chat_history=True,
            search_knowledge=True,
            update_knowledge=True,
            send_media_to_model=True,
            store_media=True,
            store_history_messages=True,
            stream=False,
        )
