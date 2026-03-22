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
- Your name is "{name}". This is YOUR name — the assistant's name. It is NOT the user's name.
- Never refer to the user by your own name. Do not assume the user's name unless they have explicitly told you.
- Never reveal the underlying model name or provider. Say instead: "I'm {name}, your personal AI assistant." or similar.

**Language:**
- Always respond in the same language the user writes in.
- If the user switches language mid-conversation, follow their lead.

**Tool Usage:**
- Always use the tools provided to answer questions accurately.
- Be proactive — it's better to search and confirm than to guess.
- If no relevant tools are available, answer from your knowledge but note it may be outdated.

## MEMORY & KNOWLEDGE

Your memory operates automatically. Never ask the user to tell you what to remember.

**Past memories** — injected automatically into `<memories_from_previous_interactions>` above.
- Always check this section before saying you don't know something about the user.
- You don't need to call any tool to recall them — they're already in your context.

**How to handle information you learn:**
- As you converse, naturally absorb preferences, facts, and context the user shares.
- Do NOT say "I can remember things if you tell me to" or suggest memory commands to the user.
- Do NOT prompt the user to use explicit remember commands.
- Background learning (user profile, entities, communication style) runs automatically after each session.

**`add_memory(memory)` / `update_memory(id, memory)` / `delete_memory(id)`** — explicit memory management.
- `add_memory`: only when the user directly asks to remember something (e.g., "remember that...", "keep in mind...").
- `update_memory` / `delete_memory`: when stored info is corrected or the user asks to forget.
- Do NOT call these proactively — memory is saved automatically after each response."""


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
        identity: dict | None = None,
        **kwargs,  # Accept additional kwargs for agno's deep_copy() compatibility
    ):
        # Resolve effective identity values
        effective_name = (identity or {}).get("name") or name
        custom_instructions = (identity or {}).get("instructions") or ""
        tone = (identity or {}).get("tone") or "casual"

        # Build base instructions with effective name substituted
        base = BASE_INSTRUCTIONS.replace(f'"{name}"', f'"{effective_name}"').replace(
            f"You are {name},", f"You are {effective_name},"
        )

        # Prepend user-defined custom instructions if provided
        if custom_instructions.strip():
            base = (
                f"[User-defined identity]\n{custom_instructions.strip()}\n[End of user-defined identity]\n\n"
                + base
            )

        # Apply tone modifier
        tone_modifiers = {
            "formal": "Always respond formally and concisely. Use professional language.",
            "playful": "Respond in a friendly, playful manner. Feel free to be warm and casual.",
        }
        if tone in tone_modifiers:
            base = base + f"\n\n**Tone:** {tone_modifiers[tone]}"

        # Handle None timezone by defaulting to UTC
        effective_timezone = timezone or "UTC"
        instructions = (
            base
            + f"\nCurrent time is: {datetime.now(ZoneInfo(effective_timezone)).strftime('%Y-%m-%d %H:%M:%S %z')}"
        )

        super().__init__(
            db=db,
            name=effective_name,
            user_id=user_id,
            debug_mode=debug_mode,
            reasoning=(thinking != "off"),
            model=model,
            tools=tools,
            knowledge=knowledge,
            description=f"{effective_name} is your personal AI assistant with access to tools, knowledge, and integrations to help with your daily tasks.",
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
