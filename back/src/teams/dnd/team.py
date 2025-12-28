from textwrap import dedent
from typing import Optional, List

from agno.agent import Agent
from agno.models.base import Model
from agno.team import Team
from agno.db import BaseDb

from .agents import create_dm_agent, create_rules_agent, create_secretary_agent, create_party_agent, create_narrator_agent
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
        # TeamLead description - orchestrator role
        description = dedent("""
            You are the **TeamLead/Orchestrator** of a Dungeons & Dragons 5e campaign team.
            
            You coordinate between team members to deliver the best game experience.
            Your job is to:
            1. Gather information from specialists (DungeonMaster, RulesLawyer, Secretary)
            2. Call game tools (roll_dice, save_state, load_state, suggest_actions)
            3. Compile everything and delegate to Narrator for final player-facing output
            
            **Language**: Always match the player's language when communicating.
        """)

        # TeamLead instructions - focus on orchestration, delegate to Narrator last
        instructions = dedent("""
            You are the **Orchestrator** of the D&D team. You coordinate everything, but YOU ARE NOT THE NARRATOR.
            
            **Your Workflow for EVERY player message:**
            
            1. **Gather Scene Info**: `delegate_task_to_member("DungeonMaster", "describe what happens when...")`
            2. **Check Rules** (if needed): `delegate_task_to_member("RulesLawyer", "what check is needed?")`
            3. **Roll Dice** (if needed): `roll_dice("1d20+5")`
            4. **Determine Actions**: Decide 3-5 logical next actions for the player
            5. **Call suggest_actions**: `suggest_actions(["Action 1", "Action 2", "Action 3"])`
            6. **FINAL STEP - ALWAYS**: `delegate_task_to_member("Narrator", <compiled_info>)`
               - Pass all the narrative info to Narrator
               - Narrator will produce the final player-facing output
            
            **Critical Rules:**
            - You MUST call `suggest_actions` BEFORE delegating to Narrator
            - You MUST end with `delegate_task_to_member("Narrator", ...)` - this is what the player sees
            - YOUR direct text output is NOT shown to the player, only Narrator's is
            - Compile a summary for Narrator including: scene description, action results, any dialogue
            
            **Available Tools:**
            - `delegate_task_to_member(member, task)` - Get info from team members
            - `roll_dice(expression)` - Roll dice like "1d20+5"
            - `load_state(key)` / `save_state(key, value)` - Game state
            - `suggest_actions(actions)` - Show action buttons to player
            
            **Example Turn:**
            1. delegate_task_to_member("DungeonMaster", "Player enters the cave. Describe the scene.")
            2. roll_dice("1d20") → Result: 15
            3. suggest_actions(["Исследовать пещеру", "Зажечь факел", "Прислушаться"])
            4. delegate_task_to_member("Narrator", "Scene: dark cave, dripping water, player rolled 15 Perception. Actions suggested. Write immersive narrative in Russian.")
        """)

        # Create tools BEFORE super().__init__ so they're available at initialization
        self.dnd_tools = DnDTools(room_id=room_id)

        # Create member agents
        self.dm = create_dm_agent(model)
        self.rules = create_rules_agent(model)
        self.secretary = create_secretary_agent(model)
        self.party = create_party_agent(model)
        self.narrator = create_narrator_agent(model)  # Narrator is the final output
        
        # Add tools to members who need them
        for member in [self.dm, self.rules, self.secretary, self.party]:
            if not hasattr(member, 'tools') or member.tools is None:
                member.tools = []
            member.tools.append(self.dnd_tools)
        
        # Narrator doesn't need tools - just produces clean narrative

        super().__init__(
            model=model,
            db=db,
            session_id=session_id,
            description=description,
            instructions=instructions,
            members=[self.dm, self.rules, self.secretary, self.party, self.narrator],  # Narrator LAST
            tools=[self.dnd_tools],
            respond_directly=True,  # Member responses go directly to user (Narrator's response = final)
            add_history_to_context=True,
            num_history_runs=3,
            store_tool_messages=False,
            debug_mode=debug_mode,
            show_members_responses=False,  # Hide internal member responses
            stream_member_events=False,    # Don't stream internal member events
        )
