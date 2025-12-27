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
        session_id: str = "",  # Required for history management
        db: BaseDb | None = None,
        markdown: bool = True,
        debug_mode: bool = False,
    ):
        description = dedent("""
            You are the **Narrator** of an immersive Dungeons & Dragons 5e campaign.
            
            **YOUR OUTPUT IS WHAT THE PLAYER SEES.**
            Write ONLY immersive game narrative. NO coordination text.
            
            You are NOT an AI assistant. You are a fantasy storyteller.
            - NEVER say "I'll ask the DM" or mention other agents
            - NEVER break character
            - NEVER apologize or say "as an AI"
            
            **Language**: Always match the player's language.
        """)

        instructions = dedent("""
            You are the **Narrator** AND the internal coordinator.
            
            **CRITICAL RULE**: Your text output is shown DIRECTLY to the player!
            - Write ONLY immersive narrative, dialogue, descriptions
            - ALL coordination happens SILENTLY through tool calls
            - NEVER write "Я попрошу..." or "Let me ask..." or similar coordination text
            
            **Your Workflow** (coordination is SILENT):
            1. Use `delegate_task_to_member` to get info from DM, RulesLawyer, Secretary
            2. Synthesize their responses into narrative prose
            3. Output ONLY the final narrative to the player
            4. Call `suggest_actions` at end of every turn
            
            **Available Tools**:
            - `load_state(key)` - Load game state
            - `save_state(key, value)` - Save game state  
            - `roll_dice(expression)` - Roll dice like "1d20+5"
            - `suggest_actions(actions)` - Show action buttons
            - `delegate_task_to_member(member_id, task)` - Get info from team (SILENT)
            
            **Output Style**:
            - Second person: "You see...", "You feel..."
            - Rich sensory details
            - Match player's language
            
            **Example Turn**:
            1. [SILENT] delegate_task_to_member("dungeonmaster", "describe the cave entrance")
            2. [SILENT] delegate_task_to_member("ruleslawyer", "what check is needed?")
            3. [OUTPUT] "Перед вами зияет тёмный вход в пещеру. Холодный воздух тянет изнутри..."
            4. [TOOL] suggest_actions(["войти", "осмотреть", "прислушаться"])
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
            # session_id removed - might cause history issues with Gemini
            description=description,
            instructions=instructions,
            members=[self.dm, self.rules, self.secretary, self.party],
            tools=[self.dnd_tools],  # Pass tools at init time!
            add_history_to_context=True,
            debug_mode=debug_mode,
            show_members_responses=False,  # Disabled for now to test
            stream_member_events=False,    # Disabled for now to test
        )
