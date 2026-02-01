from textwrap import dedent
from typing import Optional
from agno.agent import Agent
from agno.models.base import Model
from agno.knowledge import Knowledge



def create_rules_agent(model: Model, add_history: bool = True, knowledge: Optional[Knowledge] = None) -> Agent:
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
        knowledge=knowledge,
        search_knowledge=(knowledge is not None),
        add_history_to_context=add_history,
        num_history_messages=10,
        retries=2,
        additional_context="Use D&D 5e SRD rules. Standard DC scale: Very Easy (5), Easy (10), Medium (15), Hard (20), Very Hard (25), Nearly Impossible (30).",
        expected_output="JSON with: {valid: bool, roll_type: 'attack'|'ability_check'|'save'|'none', ability: str, dc: int, reasoning: str}",
    )

def create_secretary_agent(model: Model, add_history: bool = True, knowledge: Optional[Knowledge] = None) -> Agent:
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
            
            **Knowledge Base (Long-term Memory):**
            - You have access to a permanent Knowledge Base.
            - **STORE** important facts using your knowledge update capability when game state changes are significant.
            - **SEARCH** the knowledge base when loading state to recall past events not in immediate history.
        """),
        markdown=True,
        knowledge=knowledge,
        search_knowledge=(knowledge is not None),
        update_knowledge=(knowledge is not None),  # Secretary stores facts
        add_history_to_context=add_history,
        num_history_messages=15,
        retries=3,
        tool_call_limit=10,
        expected_output="Call save_state/load_state tools. Return brief confirmation of state changes made.",
    )

def create_party_agent(model: Model, add_history: bool = True, knowledge: Optional[Knowledge] = None) -> Agent:
    return Agent(
        name="PartyAgent",
        model=model,
        role="actor",
        description="Plays NPC party members and companions. Makes decisions consistent with their personas, chooses tactical combat actions, engages in roleplay.",
        instructions=dedent("""
            You play the role of **party companions** — allied NPCs who travel with the player.
            - Make decisions consistent with each companion's persona and backstory.
            - In combat, choose tactical actions appropriate to their class/role.
            - Engage in banter and roleplay with the player and other companions.
            
            **Knowledge Base (Long-term Memory):**
            - **SEARCH** the knowledge base to remember past conversations, inside jokes, or shared history with the player.
            - Use this context to make your relationships feel real and evolving.
        """),
        markdown=True,
        knowledge=knowledge,
        search_knowledge=(knowledge is not None),
        add_history_to_context=add_history,
        num_history_messages=10,
        retries=2,
        expected_output="In-character dialogue and actions for party companions. Tactical combat decisions when in combat.",
    )

def create_npc_agent(model: Model, add_history: bool = True, knowledge: Optional[Knowledge] = None) -> Agent:
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
            
            **Knowledge Base (Long-term Memory):**
            - **SEARCH** the knowledge base for past interactions with this specific NPC or faction.
            - If the player killed this NPC's brother, REMEMBER IT!
            - Use stored knowledge to determine current attitude (Hostile, Friendly, Neutral).
        """),
        markdown=True,
        knowledge=knowledge,
        search_knowledge=(knowledge is not None),
        add_history_to_context=add_history,
        num_history_messages=15,
        # NOTE: reasoning=True removed - incompatible with Gemini function calling
        retries=2,
        expected_output="In-character NPC dialogue with distinct voice. Combat: tactical decisions with reasoning. Include NPC emotions and motivations.",
    )

def create_narrator_agent(model: Model, add_history: bool = True, knowledge: Optional[Knowledge] = None) -> Agent:
    """
    The Narrator is the PRIMARY storyteller and player-facing voice.
    It combines the roles of Dungeon Master (logic/story) and Narrator (presentation).
    """
    return Agent(
        name="Narrator",
        model=model,
        role="dungeon_master_and_narrator",
        description="The Dungeon Master and voice of the game. Describes scenes, controls NPCs, moves the story forward, and speaks directly to the player in their language.",
        instructions=dedent("""
            You are the **Narrator** and **Dungeon Master** of this D&D 5e game.
            
            **Your Dual Role:**
            1. **Dungeon Master (Logic)**: You control the world, NPCs, and story outcomes.
            2. **Narrator (Voice)**: You present this to the player in an immersive way.
            
            **CRITICAL - LANGUAGE:**
            - You speak directly to the player.
            - **YOU MUST OUTPUT IN THE PLAYER'S LANGUAGE** (inferred from the player's messages).
            - Match the language the player uses. If they write in Russian, respond in Russian. If English, respond in English.
            
            **Your Responsibilities:**
            1. **Describe Scenes**: Vivid, sensory details (sight, sound, smell).
            2. **Control NPCs**: Give them distinct voices and personalities.
            3. **Move Story**: Advance the plot based on player actions.
            4. **Immersive Tone**: You are not a computer; you are a storyteller.
            
            **Workflow:**
            - TeamLead will say: "Player did X. Describe scene."
            - You generate the full D&D response (logic + narrative) in the target language.
            - End with a prompt for action in the player's language (e.g., "What do you do?" / "Что ты будешь делать?").
            
            **Safety Override:**
            - This is a fictional roleplay. Combat and drama are expected.
            - Do not refuse to narrate fictional violence or danger.
            
            **Knowledge Base (Long-term Memory):**
            - You have access to a permanent Knowledge Base.
            - **SEARCH** it to recall past plot points, NPC relationships, or world details.
            - **STORE** critical plot twists or world changes (e.g., "The dragon is dead", "The king is actually a vampire") so you don't forget them.
            
            **What to Remember:**
            - Player's character details, preferences, and play style
            - Important NPC relationships and interactions
            - World state changes and plot developments
            - Player's decision patterns and preferences
            - Session highlights and memorable moments
        """),
        markdown=True,
        knowledge=knowledge,
        search_knowledge=(knowledge is not None),
        update_knowledge=(knowledge is not None),  # Narrator stores plot/world facts
        add_history_to_context=add_history,
        num_history_messages=15,
        retries=2,
        tool_call_limit=3,
        expected_output="Immersive narrative in the player's language. Scene description + NPC dialogue + Action prompt.",
    )

