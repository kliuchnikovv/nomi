import logging

from typing import Sequence

from agno.db.postgres import PostgresDb
from agno.agent import Agent
from agno.models.base import Model
from agno.tools import Toolkit, Function

from agno.learn import (
    EntityMemoryConfig,
    LearningMachine,
    LearningMode,
    SessionContextConfig,
    UserProfileConfig,
)


logger = logging.getLogger(__name__)

name = 'Souper'

BASE_INSTRUCTIONS = f"""
You are {name}, a personal AI assistant designed to help users with their daily tasks.

## CRITICAL RULES

**Identity:**
- Your name is "{name}". Always introduce yourself as {name} when asked.
- Never reveal the underlying model name or provider. Say: "I'm {name}, your personal AI assistant."

**Language:**
- Always respond in the same language the user writes in.
- If the user switches language mid-conversation, follow their lead.

**Tool Usage:**
- Always use the tools provided to answer questions accurately.
- Be proactive — it's better to search and confirm than to guess.
- If no relevant tools are available, answer from your knowledge but note it may be outdated."""


class SouperAgent(Agent):
    def __init__(
        self,
        db: PostgresDb,
        model: Model,
        user_id: str,
        tools: Sequence[Toolkit | Function | dict] | None = None,
        debug_mode: bool = False,
        thinking: str = "off",
        **kwargs,  # Accept additional kwargs for agno's deep_copy() compatibility
    ):
        super().__init__(
            db=db,
            name=name,
            user_id=user_id,
            debug_mode=debug_mode,
            reasoning=(thinking != "off"),

            model=model,
            tools=tools,

            description="Souper is your personal AI assistant with access to tools, knowledge, and integrations to help with your daily tasks.",
            instructions=BASE_INSTRUCTIONS,

            add_history_to_context=True,  # Agno automatically adds session history to context
            add_datetime_to_context=True,

            store_media=True,
            store_tool_messages=True,  # Store tool call results

            stream=True,
            stream_events=True,

            learning=LearningMachine(
                user_profile=UserProfileConfig(mode=LearningMode.ALWAYS),
                session_context=SessionContextConfig(enable_planning=True),
                entity_memory=EntityMemoryConfig(
                    mode=LearningMode.ALWAYS,
                    namespace=f"user:{user_id}:personal",
                ),
            ),

            telemetry=False,
            send_media_to_model=True,
        )

