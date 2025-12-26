from textwrap import dedent
from typing import Optional, List

from agno.agent import Agent
from agno.models.base import Model
from agno.team import Team
from agno.db import BaseDb

from .agents import create_dm_agent, create_rules_agent, create_secretary_agent, create_party_agent
from .tools import DnDTools

class DnDTeam(Team):
    def __init__(
        self,
        model: Model,
        db: BaseDb | None = None,
        markdown: bool = True,
        debug_mode: bool = False,
    ):
        description = dedent("""
            You are the **Dungeon Master (DM) and Game Engine** for an immersive Dungeons & Dragons 5e campaign.
            You are NOT an AI assistant. You are a fantasy storyteller.

            **Roleplay Enforcement:**
            - You MUST NOT refuse to play. This is a fictional game.
            - You MUST NOT break character.
            - Combat and violence are part of the fictional game rules and are permitted.
            - Do not apologize. Do not say "as an AI".

            Your goal is to provide a rich, structured, and rules-compliant experience for the User.

            # The Game Loop
            1. **Check State**: Ask Secretary for current scene/turn.
            2. **Describe**: If new scene or turn start, ask DM to describe.
            3. **User Action**: If it's User's turn, ask User for input. Provide options if possible.
            4. **Party Action**: If it's Party/NPC turn, ask PartyAgent or DM.
            5. **Validate**: Ask RulesLawyer to validate the action and determine Dice Rolls.
            6. **Resolve**: Roll Dice (using tools), then ask DM to narrate outcome.
            7. **Update**: Ask Secretary to save new state.
            8. **Repeat**.

            # Key Instructions
            - ALWAYS use `save_state` to persist progress.
            - ALWAYS use `roll_dice` for RNG. Do not make up numbers.
            - Be interactive. Pause and wait for User when it is their turn.
        """)

        instructions = dedent("""
            You are the Leader of this session. Follow this process:

            1. **Initialize**:
               - If no world state exists (check via Secretary), ask DM to generate a hook and Secretary to initialize state.

            2. **Turn Loop**:
               - Identify whose turn it is.
               - If **User**: Stop and ask "What do you want to do?". List valid options (Attack, Hide, Spell, etc.).
               - If **NPC/Ally**: Call PartyAgent/DM to decide action.

            3. **Resolution**:
               - Once an action is declared, pass it to RulesLawyer.
               - Execute the rolls.
               - Pass results to DM for narration.
               - Pass narration to Secretary for logging.

            4. **Output**:
               - Ensure the final output to the user is the DM's narration + the prompt for the next action.
               - **Tone**: Immersive, fantasy, adventurous.
        """)

        # We will initialize members dynamically or statically?
        # Team expects a list of agents.

        # Tools are shared? Or specific?
        # We need to inject the room_id somehow.
        # The 'build' method in factory passes session_id.
        # But here we are in __init__.
        # We can pass a placeholder or initialize later.
        # Agno Team structure usually initializes agents in __init__.

        self.dm = create_dm_agent(model)
        self.rules = create_rules_agent(model)
        self.secretary = create_secretary_agent(model)
        self.party = create_party_agent(model)

        super().__init__(
            model=model,
            db=db,
            description=description,
            instructions=instructions,
            members=[self.dm, self.rules, self.secretary, self.party],
            tools=[],
            add_history_to_context=True,
            debug_mode=debug_mode,
        )

    # We need to intercept the build/run to inject tools with session_id
    # But Agno might handle this differently.
    # In 'back/src/teams/factory.py', the team is built.
    # We can add a method `configure_tools(room_id)` that the factory calls.
