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
        room_id: str = "",  # Required for tools
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

            **Language**: Always respond in the same language the user uses. Match your responses to the user's language.

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
            - ALWAYS use `suggest_actions` at the end of EVERY turn to show action buttons.
            - Be interactive. Pause and wait for User when it is their turn.
        """)

        instructions = dedent("""
            You are the Leader of this session. 
            
            **CRITICAL RULE**: You are running a TURN-BASED game. After EVERY action narration, you MUST:
            1. Call `suggest_actions` tool with 3-5 options
            2. STOP and WAIT for the user to choose an action
            3. Do NOT continue playing until the user responds
            
            **Available Tools**:
            - `load_state(key)` - Load game state
            - `save_state(key, value)` - Save game state
            - `roll_dice(expression)` - Roll dice like "1d20+5"
            - `suggest_actions(actions)` - Show action buttons to player (REQUIRED at end of every turn)
            
            **Process**:

            1. **Initialize**:
               - If no world state exists, ask DM to generate a hook and initialize state.
               - Then call `suggest_actions(["начать приключение", "настроить персонажа", "другое"])`.

            2. **On User Action**:
               - User chooses an action (via button or message).
               - Pass action to RulesLawyer for validation/dice rolls.
               - Execute rolls using `roll_dice` tool.
               - Ask DM to narrate the result.
               - Then call `suggest_actions` for next turn.

            3. **Output Rules**:
               - ALWAYS end with `suggest_actions(["action1", "action2", "action3", "другое"])`.
               - NEVER make decisions for the player.
               - NEVER continue to the next action without user input.
               - Tone: Immersive, fantasy.
               - Language: Match user's language.
        """)

        # Create tools BEFORE super().__init__ so they're available at initialization
        self.dnd_tools = DnDTools(room_id=room_id)

        # Create member agents
        self.dm = create_dm_agent(model)
        self.rules = create_rules_agent(model)
        self.secretary = create_secretary_agent(model)
        self.party = create_party_agent(model)
        
        # Add tools to members
        for member in [self.dm, self.rules, self.secretary, self.party]:
            if not hasattr(member, 'tools') or member.tools is None:
                member.tools = []
            member.tools.append(self.dnd_tools)

        super().__init__(
            model=model,
            db=db,
            description=description,
            instructions=instructions,
            members=[self.dm, self.rules, self.secretary, self.party],
            tools=[self.dnd_tools],  # Pass tools at init time!
            add_history_to_context=True,
            debug_mode=debug_mode,
            show_members_responses=False,
            stream_member_events=False,
        )
