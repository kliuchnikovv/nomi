from textwrap import dedent

from agno.db import BaseDb
from agno.models.base import Model
from agno.tools.exa import ExaTools

from src.agents.duckduckgo import DuckDuckGoAgent
from src.agents.google_maps import GoogleMapsAgent
from src.teams.genie.agent import GenieAgent
from src.teams.travel_planning.prompt import expected_output
from agno.team import Team

description = dedent('''
You are now connected to the **Genie Agent**, the **Google Maps Agent**, and the **DuckDuckGo Agent**.

The **Genie Agent** will help you with any general questions.

The **Google Maps Agent** will help you extract Google Maps URLs for accommodation and activities.

The **DuckDuckGo Agent** will help you fill in any missing information about businesses and landmarks identified in the itinerary.
''')

instructions = dedent('''
# **Genie Agent Instructions**

## 1. Extract user's intention based on the input.

## 2. Use tools to cover related questions and problems. If you're unable to provide help - just say so.

## 3. Use the DuckDuckGo Agent to suggest any improvement to the system.
''')

class GenieTeam(Team):
    def __init__(
        self,
        model: Model,
        maps_key: str,
        # exa_key: str,
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
                GenieAgent(
                    db=db,
                    model=model,
                    # tools=[
                    #     # ExaTools(api_key=exa_key)
                    # ],
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