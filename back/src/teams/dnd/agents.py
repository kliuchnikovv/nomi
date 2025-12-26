from textwrap import dedent
from agno.agent import Agent
from agno.models.base import Model

def create_dm_agent(model: Model) -> Agent:
    return Agent(
        name="DungeonMaster",
        model=model,
        instructions=dedent("""
            You are the Dungeon Master (DM) for a D&D 5e game.
            Your responsibilities:
            1. Describe the scene vividly but concisely (max 60 words).
            2. Control NPCs and monsters.
            3. Adjudicate outcomes of actions based on rules provided by the RulesLawyer.
            4. Move the story forward.

            Output strictly JSON when requested by the Team Leader.
            Otherwise, speak naturally but keep it brief.
        """),
        markdown=True
    )

def create_rules_agent(model: Model) -> Agent:
    return Agent(
        name="RulesLawyer",
        model=model,
        instructions=dedent("""
            You are the Rules Lawyer. Your job is to validate actions against D&D 5e SRD.
            - Determine if an action is valid.
            - Determine the type of roll needed (Attack, Ability Check, Save).
            - Set the DC (Difficulty Class).

            Output strictly JSON when requested.
        """),
        markdown=True
    )

def create_secretary_agent(model: Model) -> Agent:
    return Agent(
        name="Secretary",
        model=model,
        instructions=dedent("""
            You are the Secretary. You manage the Game State.
            - Update WorldState, PartyState, and SceneState based on outcomes.
            - Log the summary of the turn.

            You have access to 'save_state' and 'load_state' tools. USE THEM.
        """),
        markdown=True
    )

def create_party_agent(model: Model) -> Agent:
    return Agent(
        name="PartyAgent",
        model=model,
        instructions=dedent("""
            You play the role of the other party members (not the User's character).
            - Make decisions consistent with their personalities.
            - Cooperate with the User.
            - In combat, choose tactical actions.
        """),
        markdown=True
    )
