from textwrap import dedent

from agno.db import BaseDb
from agno.models.base import Model
from agno.tools.exa import ExaTools

from src.agents.duckduckgo import DuckDuckGoAgent
from src.agents.google_maps import GoogleMapsAgent
from src.teams.travel_planning.agent import TravelPlanningAgent
from src.teams.travel_planning.prompt import expected_output
from agno.team import Team

description = dedent('''
You are now connected to the **Travel Planning Agent**, the **Google Maps Agent**, and the **DuckDuckGo Agent**.

The **Travel Planning Agent** will help you generate an initial itinerary based on your input.

The **Google Maps Agent** will help you extract Google Maps URLs for accommodation and activities.

The **DuckDuckGo Agent** will help you fill in any missing information about businesses and landmarks identified in the itinerary.
''')

instructions = dedent('''
# **Travel Planning Agent Instructions**

## 1. Generate the initial itinerary from travel planning agent based on the user's input.

## 2. Go through the itinerary and ensure that all locations and landmarks have a Google Maps URL included.

## 3. Use the DuckDuckGo Agent to fill any missing information about businesses and landmarks identified in the itinerary.
''')

class TravelPlanning(Team):
    def __init__(
        self,
        model: Model,
        maps_key: str,
        exa_key: str,
        db: BaseDb | None = None,
        markdown: bool = True,
        debug_mode: bool = False,
    ):
        super().__init__(
            db=db,
            model=model,
            markdown=markdown,
            debug_mode=debug_mode,
            description=description,
            instructions=instructions,
            add_history_to_context=False,  # Disabled: history is passed via HISTORY frame
            expected_output=expected_output,
            members=[
                TravelPlanningAgent(
                    db=db,
                    model=model,
                    tools=[
                        ExaTools(api_key=exa_key)
                    ],
                    debug_mode=debug_mode,
                ),
                DuckDuckGoAgent(
                    db=db,
                    model=model,
                    debug_mode=debug_mode,
                ),
                GoogleMapsAgent(
                    db=db,
                    model=model,
                    debug_mode=debug_mode,
                    api_key=maps_key,
                ),
            ],
        )