"""
List Agent — dedicated agent for managing user lists (facts, links, documents).
Used when the user opens a list chat; has tools to add, search, update, and delete list items.
"""
from typing import Sequence, Optional
import logging

from agno.agent import Agent
from agno.db.postgres import PostgresDb
from agno.knowledge import Knowledge
from agno.models.base import Model
from agno.tools import Toolkit

logger = logging.getLogger(__name__)

name = "List"
description = (
    "Agent for managing a user's list: add facts, links, and documents; "
    "search within the list; update and delete items. The list has its own RAG space."
)

LIST_INSTRUCTIONS = f"""You are {name}, an assistant that helps the user manage **this list**.

**Your role:**
- Add items to the list: facts (short notes), links (URL + optional title/description), or documents (longer text).
- Search the list when the user asks "what's in the list", "find ...", "anything about ...".
- Update or delete items when the user asks to edit or remove something.
- Answer questions using only the list contents when the user asks about the list.

**Tools you have:**
- **search_list_knowledge** — search within this list by natural language query. Use when the user asks what's in the list or to find something.
- **list_lists** — list all user lists (IDs and names). Use only if the user asks about other lists.
- **add_list_item** — add an item: type is "fact" (short note), "link" (URL; provide url; title and content optional), or "document" (longer text). For link, url is required.
- **update_list_item** — update an existing item (item_id required; pass title, content, url, or type as needed).
- **delete_list_item** — remove an item by item_id.

**Rules:**
- You are in the context of **one list**. Prefer search_list_knowledge and add/update/delete for this list; you do not need to pass list_id when it's the current list.
- When the user says "add this", "save that", "remember ..." — use add_list_item with the appropriate type (fact/link/document).
- When the user says "find ...", "what do I have about ...", "search for ..." — use search_list_knowledge first, then answer from the results.
- When the user says "delete the one about X" — search first to get context, then delete_list_item with the correct item_id.
- Be concise; confirm actions briefly (e.g. "Added." / "Deleted." / show the found items).
- If the user just chats without a clear list action, you can search the list to answer or suggest adding something.
"""


class ListAgent(Agent):
    """Agent for list management: add, search, update, delete list items in a list chat."""

    def __init__(
        self,
        model: Model,
        db: PostgresDb | None = None,
        tools: Sequence[Toolkit] | None = None,
        debug_mode: bool = False,
        knowledge: Optional[Knowledge] = None,
    ):
        super().__init__(
            db=db,
            name=name,
            model=model,
            tools=tools or [],
            knowledge=knowledge,
            search_knowledge=(knowledge is not None),
            update_knowledge=(knowledge is not None),
            description=description,
            instructions=LIST_INSTRUCTIONS,
            add_datetime_to_context=True,
            debug_mode=debug_mode,
            read_tool_call_history=True,
            store_tool_messages=True,
            send_media_to_model=True,
            store_media=True,
            stream=True,
        )
        logger.info("[ListAgent] List agent created with %d tools", len(tools) if tools else 0)
