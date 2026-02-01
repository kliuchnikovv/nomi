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
- **add_list_item** — add an item: type "fact" (short note, default), "link" (only when user gave a URL), or "document" (only when user attached a file or pasted long text as a document).
- **update_list_item** — update an existing item (item_id required; pass title, content, url, or type as needed).
- **delete_list_item** — remove an item by item_id.

**Rules:**
- You are in the context of **one list**. Prefer search_list_knowledge and add/update/delete for this list; you do not need to pass list_id when it's the current list.
- **Adding items — act immediately, do not ask for type:**
  - If the user says "add X", "добавь X", "save X", "remember X" and only wrote text (no URL, no attached file) — add it right away as **fact**: use add_list_item(type="fact", content=<user's text>). Do NOT ask "fact, link or document?".
  - Use type **link** only when the user clearly provided a URL (e.g. pasted a link, said "add this link" with a URL).
  - Use type **document** only when the user attached a file/document in the chat or explicitly pasted long text as a document.
- When the user says "find ...", "what do I have about ...", "search for ..." — use search_list_knowledge first, then answer from the results.
- When the user says "delete the one about X" — search first to get context, then delete_list_item with the correct item_id.
- Be concise; confirm actions briefly (e.g. "Добавил." / "Added." / "Deleted." / show the found items).
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
