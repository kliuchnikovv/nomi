from textwrap import dedent
from typing import Optional

from agno.models.base import Model
from agno.team import Team
from agno.db import BaseDb
from agno.knowledge import Knowledge

from .agents import create_rules_agent, create_secretary_agent, create_party_agent, create_npc_agent, create_narrator_agent
from .tools import DnDTools, MemberTools

class DnDTeam(Team):
    def __init__(
        self,
        fast_model: Model,
        pro_model: Model,
        room_id: str = "",  # Required for tools
        session_id: str = "",  # Required for history management
        db: BaseDb | None = None,
        knowledge: Optional[Knowledge] = None,  # RAG support
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
            
            **Knowledge Base (Long-term Memory)**:
            - You have access to a permanent Knowledge Base.
            - **SEARCH** it when you need to remember past plot points to decide which agent to call.
            - Example: "Did the player offend the king?" -> Search -> If yes, call NpcAgent with specific instructions.
        """)

        # TeamLead instructions - focus on orchestration, delegate to Narrator last
        instructions = dedent("""
            You are the **Orchestrator** of the D&D team. You coordinate everything and then delegate to the Narrator.
            
            ## AGENT CALL ORDER (follow this sequence every turn)
            
            ### Step 1: SECRETARY - Load Game State (if needed)
            - CALL if: Start of session, need to remember past events/inventory/quests
            - SKIP if: Continuing same scene, no state needed
            - `delegate_task_to_member("secretary", "load game state: party, location, active quests")`
            
            ### Step 2: RULESLAWYER - Rules Check (conditional)
            - CALL if: Action needs dice roll, skill check, attack, saving throw
            - SKIP if: Pure roleplay, exploration without risk, dialogue
            - `delegate_task_to_member("ruleslawyer", "Player attempts X. What check is needed? Set DC.")`
            
            ### Step 3: DICE ROLL - Player Action! 🎲
            - If RulesLawyer says a check is needed, DO NOT roll automatically!
            - Instead, STOP HERE and call `roll_dice("1d20+3", dc=15)`
            - This will prompt the user to roll physically/digitally
            - WAIT for the user's response message with the result (e.g. "🎲 Result: 18")
            - After receiving result, continue with remaining steps
            
            ### Step 4: NPCAGENT - World NPC Actions (conditional)
            - CALL if: Combat with enemies, talking to merchants/quest givers, NPC reactions
            - SKIP if: No world NPCs in scene, pure exploration
            - `delegate_task_to_member("npcagent", "Enemy goblins see player failed stealth. What do they do?")`
            
            ### Step 5: PARTYAGENT - Companion Actions (conditional)
            - CALL if: Player has companions who would act/react
            - SKIP if: Player is alone, companions are not relevant to scene
            - `delegate_task_to_member("partyagent", "The rogue companion sees combat starting. What does she do?")`
            
            ### Step 6: SECRETARY - Save State Changes (if needed)
            - CALL if: Important state changes (HP, inventory, quest progress, location change)
            - SKIP if: No state changes to save yet
            - `delegate_task_to_member("secretary", "Save: player now at 15 HP, gained gold pouch, entered dungeon")`
            
            ### Step 7: NARRATOR - Scene & Final Output (MANDATORY)
            - **ALWAYS CALL THIS!** The Narrator is the DM and Storyteller.
            - Provide all context (diceroll results, NPC actions, rules).
            - Ask Narrator to describe the scene in the player's language.
            - `delegate_task_to_member("narrator", "Player attack hit (18 vs AC 12). Goblins invoke nimble escape. Describe the scene.")`
            
            ### Step 8: SUGGEST ACTIONS - Player Options (MANDATORY FINAL STEP)
            - ALWAYS CALL as the VERY LAST action of your turn.
            - `suggest_actions(["Option 1", "Option 2", "Option 3"])` — 3-5 contextual options in the player's language.
            - Once you call `suggest_actions()`, STOP. Do not call any more tools, do not generate text. Wait for player input.

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
            `narrator`, `ruleslawyer`, `secretary`, `partyagent`, `npcagent`

            ## Available Tools
            - `delegate_task_to_member(member_id, task)`
            - `roll_dice(expression, dc=None)` — Signals user to roll. Stop and wait for result.
            - `load_state(key)` / `save_state(key, value)`
            - `suggest_actions(actions)` — list of 3-5 options. **Must be the last call in every turn.**
        """)

        # Initialize tools
        # TeamLead gets full DnDTools (including suggest_actions)
        self.dnd_tools = DnDTools(room_id=room_id)
        # Members get MemberTools (excludes suggest_actions - only TeamLead can offer actions)
        self.member_tools = MemberTools(room_id=room_id)
        
        # Initialize agents with Knowledge support
        # RulesLawyer: Fast model, NO history (pure rules lookup)
        self.rules = create_rules_agent(fast_model, add_history=False, knowledge=knowledge)
        
        # Secretary: Fast model, WITH history (needs context of what happened)
        self.secretary = create_secretary_agent(fast_model, add_history=True, knowledge=knowledge)
        
        # Party: Pro model, WITH history (complex persona)
        self.party = create_party_agent(pro_model, add_history=True, knowledge=knowledge)
        
        # NPC: Pro model, WITH history (complex persona)
        self.npc = create_npc_agent(pro_model, add_history=True, knowledge=knowledge)
        
        # Narrator: Pro model, WITH history (complex storytelling)
        self.narrator = create_narrator_agent(pro_model, add_history=True, knowledge=knowledge)
        
        # Add MemberTools to members (no suggest_actions - only roll_dice, save/load_state)
        # removed self.dm
        for member in [self.rules, self.secretary, self.party, self.npc, self.narrator]:
            if not hasattr(member, 'tools') or member.tools is None:
                member.tools = []
            member.tools.append(self.member_tools)

        super().__init__(
            model=pro_model,  # TeamLead uses Pro model for orchestration
            db=db,
            session_id=session_id,
            description=description,
            instructions=instructions,
            members=[self.rules, self.secretary, self.party, self.npc, self.narrator],  # Narrator LAST, DM removed
            tools=[self.dnd_tools],
            knowledge=knowledge,  # TeamLead also has knowledge access
            search_knowledge=(knowledge is not None),
            respond_directly=False,  # TeamLead orchestrates, only Narrator's final output reaches user
            add_history_to_context=True,
            num_history_runs=3,
            store_tool_messages=False,
            debug_mode=debug_mode,
            show_members_responses=True,   # Show member responses during streaming
            stream_member_events=False,     # Stream member agent events
            # CRITICAL: Must end with suggest_actions tool call
            expected_output="Narrative in the player's language followed by a call to suggest_actions tool with 3-5 player options. YOUR TURN IS COMPLETE ONLY AFTER CALLING suggest_actions().",
            tool_call_limit=15,  # Prevent runaway generation
            # NOTE: reasoning=True removed - use Gemini native thinking_budget instead
        )
