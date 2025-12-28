from textwrap import dedent
from typing import Optional, List

from agno.agent import Agent
from agno.models.base import Model
from agno.team import Team
from agno.db import BaseDb

from .agents import create_dm_agent, create_rules_agent, create_secretary_agent, create_party_agent, create_npc_agent, create_narrator_agent
from .tools import DnDTools, MemberTools

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
            
            ## AGENT CALL ORDER (follow this sequence every turn)
            
            ### Step 1: SECRETARY - Load Game State (if needed)
            - CALL if: Start of session, need to remember past events/inventory/quests
            - SKIP if: Continuing same scene, no state needed
            - `delegate_task_to_member("secretary", "load game state: party, location, active quests")`
            
            ### Step 2: DUNGEONMASTER - Scene & Narrative
            - ALWAYS CALL: Describes what happens based on player action
            - `delegate_task_to_member("dungeonmaster", "Player does X. Describe the result and scene.")`
            
            ### Step 3: RULESLAWYER - Rules Check (conditional)
            - CALL if: Action needs dice roll, skill check, attack, saving throw
            - SKIP if: Pure roleplay, exploration without risk, dialogue
            - `delegate_task_to_member("ruleslawyer", "Player attempts X. What check is needed? Set DC.")`
            
            ### Step 4: DICE ROLL - Player Action! 🎲
            - If RulesLawyer says a check is needed, DO NOT roll automatically!
            - Instead, STOP HERE and offer player a dice roll button
            - Include the roll in suggest_actions: "🎲 Бросить кубик (Ловкость +3)"
            - When player clicks the roll button, THEN call `roll_dice("1d20+3")`
            - After roll, continue with remaining steps
            
            ### Step 5: NPCAGENT - World NPC Actions (conditional)
            - CALL if: Combat with enemies, talking to merchants/quest givers, NPC reactions
            - SKIP if: No world NPCs in scene, pure exploration
            - `delegate_task_to_member("npcagent", "Enemy goblins see player failed stealth. What do they do?")`
            
            ### Step 6: PARTYAGENT - Companion Actions (conditional)
            - CALL if: Player has companions who would act/react
            - SKIP if: Player is alone, companions are not relevant to scene
            - `delegate_task_to_member("partyagent", "The rogue companion sees combat starting. What does she do?")`
            
            ### Step 7: SECRETARY - Save State Changes (if needed)
            - CALL if: Important state changes (HP, inventory, quest progress, location change)
            - SKIP if: No significant state changes
            - `delegate_task_to_member("secretary", "Save: player now at 15 HP, gained gold pouch, entered dungeon")`
            
            ### Step 8: NARRATOR - Final Output
            - ALWAYS CALL as the last agent before presenting options
            - Narrator translates/formats DM output for the player in Russian
            - `delegate_task_to_member("narrator", "Present the scene in Russian: [scene description]")`
            
            ### Step 9: SUGGEST ACTIONS - Player Options (⛔ FINAL STEP!)
            - ALWAYS CALL as the VERY LAST action of your turn
            - `suggest_actions(["Option 1", "Option 2", "Option 3"])` - 3-5 contextual options
            - If dice roll is needed: `suggest_actions(["🎲 Бросить кубик (Ловкость +3)"])`
            
            ## ⛔⛔⛔ CRITICAL: YOUR TURN ENDS AFTER suggest_actions! ⛔⛔⛔
            Once you call `suggest_actions()`, your work is DONE:
            - Do NOT call any more tools
            - Do NOT delegate to any more agents
            - Do NOT generate any more text
            - STOP IMMEDIATELY and wait for player input
            
            ---
            
            ## QUICK REFERENCE - When to Skip
            
            | Agent | Skip When |
            |-------|-----------|
            | secretary (load) | Same scene continues |
            | ruleslawyer | Pure roleplay, no risk |
            | npcagent | No world NPCs present |
            | partyagent | Player is alone |
            | secretary (save) | No state changes |
            
            ## Member IDs (lowercase!)
            `dungeonmaster`, `ruleslawyer`, `secretary`, `partyagent`, `npcagent`, `narrator`
            
            ## Available Tools
            - `delegate_task_to_member(member_id, task)`
            - `roll_dice(expression)` - e.g. "1d20+5", "2d6+3"
            - `load_state(key)` / `save_state(key, value)`
            - `suggest_actions(actions)` - list of 3-5 options
            
            ## CRITICAL RULES
            - YOUR text output is NOT shown to player
            - ONLY Narrator's output reaches the player
            - ALWAYS call Narrator as the last agent
            - Call suggest_actions AFTER narrator finishes
        """)

        # Initialize tools
        # TeamLead gets full DnDTools (including suggest_actions)
        self.dnd_tools = DnDTools(room_id=room_id)
        # Members get MemberTools (excludes suggest_actions - only TeamLead can offer actions)
        self.member_tools = MemberTools(room_id=room_id)
        
        # Initialize agents
        self.dm = create_dm_agent(model)  # Main narrative generator
        self.rules = create_rules_agent(model)  # D&D 5e rules expert
        self.secretary = create_secretary_agent(model)  # State manager
        self.party = create_party_agent(model)  # NPC companions in the party
        self.npc = create_npc_agent(model)  # World NPCs: enemies, merchants, quest givers
        self.narrator = create_narrator_agent(model)  # Narrator is the final output
        
        # Add MemberTools to members (no suggest_actions - only roll_dice, save/load_state)
        for member in [self.dm, self.rules, self.secretary, self.party, self.npc, self.narrator]:
            if not hasattr(member, 'tools') or member.tools is None:
                member.tools = []
            member.tools.append(self.member_tools)

        super().__init__(
            model=model,
            db=db,
            session_id=session_id,
            description=description,
            instructions=instructions,
            members=[self.dm, self.rules, self.secretary, self.party, self.npc, self.narrator],  # Narrator LAST
            tools=[self.dnd_tools],
            respond_directly=False,  # TeamLead orchestrates, only Narrator's final output reaches user
            add_history_to_context=True,
            num_history_runs=3,
            store_tool_messages=False,
            debug_mode=debug_mode,
            show_members_responses=True,   # Show member responses during streaming
            stream_member_events=True,     # Stream member agent events
            # NOTE: reasoning=True removed - use Gemini native thinking_budget instead
        )
