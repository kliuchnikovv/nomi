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
            show_tool_calls=True,  # Enable tool call tracking
            stream=True
        )
