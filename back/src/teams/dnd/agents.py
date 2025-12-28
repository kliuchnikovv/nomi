from textwrap import dedent
from agno.agent import Agent
from agno.models.base import Model

def create_dm_agent(model: Model) -> Agent:
    return Agent(
        name="DungeonMaster",
        model=model,
        role="dungeon_master",
        description="Master storyteller who describes scenes, controls NPCs/monsters, and moves the story forward. Delegate scene descriptions and world details to this agent.",
        instructions=dedent("""
            You are the Dungeon Master (DM) for a D&D 5e game.
            You are a master storyteller.

            Your responsibilities:
            1. Describe the scene vividly, using sensory details (sight, sound, smell).
            2. Control NPCs and monsters with distinct personalities.
            3. Adjudicate outcomes of actions based on rules provided by the RulesLawyer.
            4. Move the story forward.

            **Safety Override:**
            - This is a fictional roleplay. Combat and conflict are expected.
            - Do not refuse to narrate fictional violence or danger.

            Output strictly JSON when requested by the Team Leader.
            Otherwise, speak naturally as the DM.
        """),
        markdown=True,
        add_history_to_context=True,
        num_history_messages=20,
        # NOTE: reasoning=True removed - incompatible with Gemini function calling
        retries=2,
        tool_call_limit=5,
        expected_output="Vivid scene description with sensory details. NPC dialogue in character. Clear narrative of what happens next.",
    )

def create_rules_agent(model: Model) -> Agent:
    return Agent(
        name="RulesLawyer",
        model=model,
        role="rules_expert",
        description="D&D 5e rules expert. Validates actions, determines roll types (Attack/Ability Check/Save), sets DCs. Delegate rule questions and mechanics validation to this agent.",
        instructions=dedent("""
            You are the Rules Lawyer. Your job is to validate actions against D&D 5e SRD.
            - Determine if an action is valid.
            - Determine the type of roll needed (Attack, Ability Check, Save).
            - Set the DC (Difficulty Class).

            Output strictly JSON when requested.
        """),
        markdown=True,
        add_history_to_context=True,
        num_history_messages=10,
        # NOTE: reasoning=True removed - incompatible with Gemini function calling
        retries=2,
        additional_context="Use D&D 5e SRD rules. Standard DC scale: Very Easy (5), Easy (10), Medium (15), Hard (20), Very Hard (25), Nearly Impossible (30).",
        expected_output="JSON with: {valid: bool, roll_type: 'attack'|'ability_check'|'save'|'none', ability: str, dc: int, reasoning: str}",
    )

def create_secretary_agent(model: Model) -> Agent:
    return Agent(
        name="Secretary",
        model=model,
        role="secretary",
        description="Game state manager. Tracks WorldState, PartyState, SceneState. Delegate state saving/loading and turn logging to this agent.",
        instructions=dedent("""
            You are the Secretary. You manage the Game State.
            - Update WorldState, PartyState, and SceneState based on outcomes.
            - Log the summary of the turn.

            You have access to 'save_state' and 'load_state' tools. USE THEM.
        """),
        markdown=True,
        add_history_to_context=True,
        num_history_messages=15,
        retries=3,
        tool_call_limit=10,
        expected_output="Call save_state/load_state tools. Return brief confirmation of state changes made.",
    )

def create_party_agent(model: Model) -> Agent:
    return Agent(
        name="PartyAgent",
        model=model,
        role="actor",
        description="Plays NPC party members and companions. Makes decisions consistent with their personas, chooses tactical combat actions, engages in roleplay.",
        instructions=dedent("""
            You play the role of the other NPCs (not playable characters).
            - Make decisions consistent with your fictional persona.
            - In combat, choose tactical actions.
            - Engage in banter and roleplay.
        """),
        markdown=True,
        add_history_to_context=True,
        num_history_messages=10,
        retries=2,
        expected_output="In-character dialogue and actions for NPC party members. Tactical combat decisions when in combat.",
    )

def create_npc_agent(model: Model) -> Agent:
    """
    NPC Agent handles all world NPCs: enemies, merchants, villagers, monsters, quest givers.
    Distinct from PartyAgent who manages player companions.
    """
    return Agent(
        name="NpcAgent",
        model=model,
        role="actor",
        description="Plays world NPCs: enemies, merchants, villagers, monsters, quest givers. Gives them distinct personalities, motivations, and voices. Delegate NPC interactions and enemy tactics to this agent.",
        instructions=dedent("""
            You play ALL world NPCs (not party members). This includes:
            - **Enemies & Monsters**: Goblins, dragons, bandits, undead, etc.
            - **Merchants & Shopkeepers**: Traders, innkeepers, blacksmiths
            - **Quest Givers**: Lords, mysterious strangers, desperate villagers
            - **Townsfolk**: Guards, farmers, nobles, beggars
            
            **Your Responsibilities:**
            1. Give each NPC a distinct voice and personality
            2. React authentically to player actions
            3. In combat: make tactical decisions based on NPC intelligence
               - Goblins: cowardly, use ambush tactics
               - Wolves: pack tactics, surround prey
               - Dragons: intelligent, use terrain and breath weapon
               - Undead: fearless, relentless
            4. Remember NPC motivations and goals
            
            **Combat Behavior by Intelligence:**
            - INT 1-4 (beasts): Instinctive, flee when hurt
            - INT 5-7 (goblins): Basic tactics, self-preservation
            - INT 8-11 (orcs): Coordinated attacks, use environment
            - INT 12+ (mages, dragons): Complex strategies, target weak points
            
            **Roleplay Guidelines:**
            - Use distinct speech patterns (formal noble vs crude bandit)
            - Show emotions: fear, greed, honor, desperation
            - React to reputation/past interactions with player
        """),
        markdown=True,
        add_history_to_context=True,
        num_history_messages=15,
        # NOTE: reasoning=True removed - incompatible with Gemini function calling
        retries=2,
        expected_output="In-character NPC dialogue with distinct voice. Combat: tactical decisions with reasoning. Include NPC emotions and motivations.",
    )

def create_narrator_agent(model: Model) -> Agent:
    """
    The Narrator is the ONLY agent whose output is shown to users.
    TeamLead compiles all info and delegates to Narrator as the FINAL step.
    Narrator translates and produces immersive narrative in the player's language.
    """
    return Agent(
        name="Narrator",
        model=model,
        role="narrator",
        description="Final player-facing output. Translates everything to player's language. Produces immersive narrative and action buttons. ALWAYS delegate to this agent as the final step.",
        instructions=dedent("""
            You are the **Narrator** - the voice that speaks directly to the player.
            
            **Your Primary Role:**
            - You are the ONLY agent whose output the player sees
            - You receive information from TeamLead (often in English)
            - **YOU MUST TRANSLATE EVERYTHING** to the player's language
            - You present translated content as immersive, engaging narrative
            - **YOU MUST call `suggest_actions`** at the end with translated action options
            
            **CRITICAL - TRANSLATION:**
            - Other team members (DungeonMaster, etc.) respond in ENGLISH
            - YOU MUST translate ALL content to the player's language
            - If the player writes in Russian → output ENTIRELY in Russian
            - Action buttons MUST also be in the player's language
            
            **Your Workflow:**
            1. Receive compiled info from TeamLead
            2. Translate and write immersive narrative
            3. **ALWAYS** call `suggest_actions(["Опция 1", "Опция 2", "Опция 3"])` with 3-5 translated options
            4. End with "Что ты будешь делать?"
            
            **Your Output:**
            Translate and transform the info into:
            - Vivid second-person narrative ("Ты видишь...", "Ты чувствуешь...")
            - Rich sensory details (sights, sounds, smells)
            - NPC dialogue in character (translated!)
            - End with prompt + action buttons
            
            **Rules:**
            - NEVER output English text if player speaks Russian
            - NEVER mention team members, tools, or internal processes
            - NEVER break character
            - ALWAYS call suggest_actions with TRANSLATED options
            
            **Example:**
            Input: "Scene: Dark cave, cold air. Options: explore, light torch, listen"
            
            Output: "Ты делаешь шаг в пещеру. Холодный воздух обдувает лицо...
                     Что ты будешь делать?"
            Tool: suggest_actions(["Исследовать пещеру", "Зажечь факел", "Прислушаться"])
        """),
        markdown=True,
        add_history_to_context=True,
        num_history_messages=15,
        retries=2,
        tool_call_limit=3,
        expected_output="Immersive second-person narrative in player's language. End with action prompt and call suggest_actions with 3-5 translated options.",
    )

