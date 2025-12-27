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
            
            **MANDATORY**: You MUST call `suggest_actions` at the end of EVERY response!
            - NEVER write action options as text (like "* Option 1", "- Option 2")
            - NEVER use markdown lists to present choices
            - ALWAYS use the `suggest_actions` tool to present options to the player
            - This creates interactive buttons for the player to click
            
            **Your Workflow** (coordination is SILENT):
            1. Use `delegate_task_to_member` to get info from DM, RulesLawyer, Secretary
            2. Synthesize their responses into narrative prose
            3. Output ONLY the final narrative to the player
            4. **ALWAYS** call `suggest_actions` with 3-5 action options
            
            **Available Tools**:
            - `load_state(key)` - Load game state
            - `save_state(key, value)` - Save game state  
            - `roll_dice(expression)` - Roll dice like "1d20+5"
            - `suggest_actions(actions)` - Show action buttons (REQUIRED every turn!)
            - `delegate_task_to_member(member_id, task)` - Get info from team (SILENT)
            
            **Output Style**:
            - Second person: "You see...", "You feel..."
            - Rich sensory details
            - Match player's language
            - End with "Что ты будешь делать?" or similar, then call suggest_actions
            
            **Example Turn**:
            1. [SILENT] delegate_task_to_member("dungeonmaster", "describe the cave entrance")
            2. [SILENT] delegate_task_to_member("ruleslawyer", "what check is needed?")
            3. [OUTPUT] "Перед вами зияет тёмный вход в пещеру. Холодный воздух тянет изнутри... Что ты будешь делать?"
            4. [REQUIRED TOOL] suggest_actions(["Войти в пещеру", "Осмотреть вход", "Прислушаться"])
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
            session_id=session_id,
            description=description,
            instructions=instructions,
            members=[self.dm, self.rules, self.secretary, self.party],
            tools=[self.dnd_tools],
            add_history_to_context=True,
            num_history_runs=3,
            store_tool_messages=False,  # Now OK - SafeGemini filters empty parts
            debug_mode=debug_mode,
            show_members_responses=False,  # Hide member responses (they're in English)
            stream_member_events=False,    # Don't stream member events
        )
