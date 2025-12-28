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
            
            1. **Gather Scene Info**: `delegate_task_to_member("dungeonmaster", "describe what happens when...")`
            2. **Check Rules** (if needed): `delegate_task_to_member("ruleslawyer", "what check is needed?")`
            3. **Roll Dice** (if needed): `roll_dice("1d20+5")`
            4. **Determine Actions**: Decide 3-5 logical next actions for the player
            5. **Call suggest_actions**: `suggest_actions(["Action 1", "Action 2", "Action 3"])`
            6. **FINAL STEP - ALWAYS**: `delegate_task_to_member("narrator", <compiled_info>)`
               - Pass ONLY the "Scene Facts", "Outcome", and "Suggested Actions" to Narrator.
               - **DO NOT** pass your internal reasoning, thought process, or raw JSON logs.
               - **DO NOT** pass "I think the player wants..." or "The dice rolled X so...". Just facts.
            
            **Critical Rules:**
            - You MUST call `suggest_actions` BEFORE delegating to narrator
            - You MUST end with `delegate_task_to_member("narrator", ...)` - this is what the player sees
            - YOUR direct text output is NOT shown to the player, only narrator's is
            - Compile a CLEAN summary for narrator.
            
            **Member IDs (use lowercase):**
            - `dungeonmaster` - Scene descriptions, NPCs, world details
            - `ruleslawyer` - Rules, dice rolls, checks
            - `secretary` - Game state management
            - `partyagent` - NPC party members
            - `narrator` - Final player-facing output (ALWAYS call last!)
            
            **Available Tools:**
            - `delegate_task_to_member(member_id, task)` - Get info from team members (use lowercase IDs!)
            - `roll_dice(expression)` - Roll dice like "1d20+5"
            - `load_state(key)` / `save_state(key, value)` - Game state
            - `suggest_actions(actions)` - Show action buttons to player
            
            **Example Turn:**
            1. delegate_task_to_member("dungeonmaster", "Player enters the cave. Describe the scene.")
            2. roll_dice("1d20") → Result: 15
            3. suggest_actions(["Исследовать пещеру", "Зажечь факел", "Прислушаться"])
            4. delegate_task_to_member("narrator", "Scene: dark cave, dripping water. Outcome: Player succeeds (15). Options: Explore, Torch, Listen.")
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
        
        # Narrator gets tools too - specifically needs suggest_actions to show translated action buttons
        if not hasattr(self.narrator, 'tools') or self.narrator.tools is None:
            self.narrator.tools = []
        self.narrator.tools.append(self.dnd_tools)

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
