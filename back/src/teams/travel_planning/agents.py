from typing import Sequence

from agno.agent import Agent
from agno.db import BaseDb
from agno.models.base import Model
from agno.tools import Toolkit, Function
from src.teams.travel_planning.prompt import system_prompt_travel_agent, expected_output, instruction

name='Travel Planning Agent'
description=system_prompt_travel_agent
instructions=instruction
output=expected_output

class TravelPlanningAgent(Agent):
    def __init__(
        self,
        model: Model,
        db: BaseDb | None = None,
        tools: Sequence[Toolkit | Function | dict] | None = None,
        debug_mode: bool = False,
    ):
        super().__init__(
            db=db,
            name=name,
            model=model,
            tools=tools,
            description=description,
            instructions=instructions,
            expected_output=output,
            add_history_to_context=True,  # Required for Agno to use messages parameter
            add_datetime_to_context=True,
            debug_mode=debug_mode,
        )
