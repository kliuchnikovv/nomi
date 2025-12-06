from typing import Sequence

from agno.db.postgres import PostgresDb
from agno.agent import Agent
from agno.models.base import Model
from agno.tools import Toolkit, Function
# from src.teams.genie.prompt import system_prompt_travel_agent, expected_output, instruction

name='Genie'
# description=system_prompt_travel_agent
# instructions=instruction
# expected_output=expected_output

class GenieAgent(Agent):
    def __init__(
        self,
        model: Model,
        db: PostgresDb | None = None,
        tools: Sequence[Toolkit | Function | dict] | None = None,
        debug_mode: bool = False,
    ):
        super().__init__(
            db=db,
            name=name,
            model=model,
            tools=tools,
            description="You are helpful personal assistant.",
            # instructions=instruction,
            # expected_output=expected_output,
            add_history_to_context=True,  # Required for Agno to use messages parameter
            add_datetime_to_context=True,
            debug_mode=debug_mode,
            read_tool_call_history=True,  # Enable reading tool call history
            store_tool_messages=True,  # Store tool call results
            read_chat_history=True,
            search_knowledge=True,
            update_knowledge=True,
            send_media_to_model=True,
            store_media=True,
            store_history_messages=True,
            stream=True
        )

