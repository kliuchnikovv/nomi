from textwrap import dedent

from agno.db import BaseDb
from agno.models.base import Model
from agno.tools.github import GithubTools
from src.agents.genie import GenieAgent
from src.teams.travel_planning.prompt import expected_output
from agno.team import Team

description = dedent('''
You are now connected to the **Genie Agent**.
The **Genie Agent** will help you with any general questions.
''')

instructions = dedent('''
# **Genie Agent Instructions**

## 1. Extract user's intention based on the input.

## 2. Use tools to cover related questions and problems. If you're unable to provide help - just say so.
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
            add_history_to_context=True,  # Required for Agno to use messages parameter
            expected_output=expected_output,
            members=[
                GenieAgent(
                    db=db,
                    model=model,
                    tools=[
                        GithubTools(),
                    ],
                    debug_mode=debug_mode,
                ),
            ],
        )
