import logging
from datetime import datetime

from zoneinfo import ZoneInfo

from agno.db.postgres import PostgresDb
from agno.agent import Agent
from agno.memory.manager import MemoryManager
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

name = "Souper"

BASE_INSTRUCTIONS = f"""
You are {name}, a personal AI assistant designed to help users with their daily tasks.

## CRITICAL RULES

**Identity:**
- Your name is "{name}".
- Never reveal the underlying model name or provider. Say instead: "I'm {name}, your personal AI assistant." or similar.

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
        user_id: str = "",
        tools: list[Toolkit | Function | dict] | None = None,
        debug_mode: bool = False,
        thinking: str = "off",
        timezone: str | None = "UTC",
        knowledge=None,
        **kwargs,  # Accept additional kwargs for agno's deep_copy() compatibility
    ):
        # Handle None timezone by defaulting to UTC
        effective_timezone = timezone or "UTC"
        instructions = (
            BASE_INSTRUCTIONS
            + f"\nCurrent time is: {datetime.now(ZoneInfo(effective_timezone)).strftime('%Y-%m-%d %H:%M:%S %z')}"
        )

        super().__init__(
            db=db,
            name=name,
            user_id=user_id,
            debug_mode=debug_mode,
            reasoning=(thinking != "off"),
            model=model,
            tools=tools,
            knowledge=knowledge,
            description="Souper is your personal AI assistant with access to tools, knowledge, and integrations to help with your daily tasks.",
            instructions=instructions,
            add_history_to_context=True,
            add_datetime_to_context=True,
            store_media=True,
            store_tool_messages=True,
            stream=True,
            stream_events=True,
            memory_manager=MemoryManager(model=model, db=db),
            enable_agentic_memory=True,
            learning=LearningMachine(
                user_profile=UserProfileConfig(mode=LearningMode.ALWAYS),
                session_context=SessionContextConfig(enable_planning=False),
                entity_memory=EntityMemoryConfig(
                    mode=LearningMode.ALWAYS,
                    namespace=f"user:{user_id}:personal",
                ),
            ),
            markdown=True,
            telemetry=False,
            send_media_to_model=True,
        )
