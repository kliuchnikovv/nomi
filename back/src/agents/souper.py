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
    UserProfileConfig,
)

logger = logging.getLogger(__name__)

name = "Souper"

# Maximum number of unique memories to keep in the injected context.
# Older duplicates are pruned after each run.
MAX_UNIQUE_MEMORIES = 30

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

**Maps & Navigation (IMPORTANT):**
- When the user asks to find nearby places (stores, cafés, restaurants, pharmacies, etc.) → call `search_places`. Never list locations as plain text only.
- When the user asks for directions, a route, or how to get somewhere → call `open_route`. Never just describe the route in text.
- These tools return action buttons that let the user open Apple Maps directly. Always use them — don't ask for confirmation first, just call the tool.
- After calling `search_places`: do NOT list or repeat the place names in your text response. The action buttons already show each place — listing them in text creates confusing duplicates. Just say one brief line like "Вот ближайшие результаты:" and stop.
- Never call the same tool with the same parameters more than once per response.
- **`near` parameter**: when the user says "near me", "рядом", "closest to me", or similar — ALWAYS use the exact string from `User's current location` in your instructions as the `near` value. Never substitute a landmark, neighbourhood name, or anything from conversation history.

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
        user_location: str | None = None,
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

        # Guard against LearningMachine incorrectly storing the bot's own name as the user's name
        base = (
            base
            + f"\n\n**IMPORTANT — User Profile Name Guard:** If `<user_profile>` contains `Name: {effective_name}` or `Preferred Name: {effective_name}`, IGNORE that field entirely — it was incorrectly recorded by the learning system. The user's name is unknown unless they have explicitly told you in this conversation."
        )

        # Handle None timezone by defaulting to UTC
        effective_timezone = timezone or "UTC"
        instructions = (
            base
            + f"\nCurrent time is: {datetime.now(ZoneInfo(effective_timezone)).strftime('%Y-%m-%d %H:%M:%S %z')}"
        )
        if user_location:
            instructions += f"\nUser's current location: {user_location}"

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
                session_context=None,
                entity_memory=EntityMemoryConfig(
                    mode=LearningMode.ALWAYS,
                    namespace=f"user:{user_id}:personal",
                ),
            ),
            markdown=True,
            telemetry=False,
            send_media_to_model=True,
        )

    # ------------------------------------------------------------------
    # Memory deduplication
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_memory_text(text: str) -> str:
        """Normalize memory text for deduplication comparison."""
        if not text:
            return ""
        # Lowercase, strip whitespace, collapse multiple spaces
        return " ".join(text.lower().split())

    async def _deduplicate_memories(self) -> int:
        """Remove duplicate memories for this user.

        Keeps the most recent instance of each unique (normalized) memory
        and prunes the total count to ``MAX_UNIQUE_MEMORIES``.

        Returns the number of memories deleted.
        """
        if not self.memory_manager or not self.user_id:
            return 0

        try:
            db = self.memory_manager.db
            if db is None:
                return 0

            memories = db.get_user_memories(user_id=self.user_id)
            if not memories:
                return 0

            # Group by normalized text
            seen: dict[str, list] = {}
            for mem in memories:
                key = self._normalize_memory_text(
                    mem.memory if hasattr(mem, "memory") else str(mem)
                )
                seen.setdefault(key, []).append(mem)

            # Identify duplicates (keep newest per group)
            ids_to_delete: list[str] = []
            for _key, group in seen.items():
                if len(group) > 1:
                    # Sort by updated_at descending — keep the first (newest)
                    group.sort(
                        key=lambda m: getattr(m, "updated_at", None) or 0,
                        reverse=True,
                    )
                    for duplicate in group[1:]:
                        mem_id = getattr(duplicate, "memory_id", None)
                        if mem_id:
                            ids_to_delete.append(mem_id)

            # If still over the limit after dedup, trim oldest globally
            if len(memories) - len(ids_to_delete) > MAX_UNIQUE_MEMORIES:
                remaining = [
                    m
                    for m in memories
                    if getattr(m, "memory_id", None) not in set(ids_to_delete)
                ]
                remaining.sort(
                    key=lambda m: getattr(m, "updated_at", None) or 0,
                )
                excess = len(remaining) - MAX_UNIQUE_MEMORIES
                for m in remaining[:excess]:
                    mem_id = getattr(m, "memory_id", None)
                    if mem_id:
                        ids_to_delete.append(mem_id)

            if ids_to_delete:
                try:
                    db.delete_user_memories(ids_to_delete, user_id=self.user_id)
                except Exception:
                    # Fallback: delete one by one
                    for mem_id in ids_to_delete:
                        try:
                            db.delete_user_memory(mem_id, user_id=self.user_id)
                        except Exception:
                            pass
                logger.info(
                    "[Souper] Deduplicated memories: deleted %d duplicates for user %s",
                    len(ids_to_delete),
                    self.user_id,
                )

            return len(ids_to_delete)

        except Exception as exc:
            logger.warning("[Souper] Memory deduplication failed: %s", exc)
            return 0

    async def arun(self, *args, **kwargs):
        """Run agent and deduplicate memories afterwards.

        Agent.arun(stream=True) returns an async generator, not a coroutine.
        We must handle both cases: streaming (yield events, dedup after) and
        non-streaming (await result, dedup after).
        """
        stream = kwargs.get("stream", self.stream) if hasattr(self, "stream") else kwargs.get("stream", False)
        parent_arun = super().arun(*args, **kwargs)

        if stream:
            # Wrap the async generator to run dedup after iteration completes
            async def _stream_with_dedup():
                try:
                    async for event in parent_arun:
                        yield event
                finally:
                    try:
                        await self._deduplicate_memories()
                    except Exception:
                        pass
            return _stream_with_dedup()
        else:
            result = await parent_arun
            try:
                await self._deduplicate_memories()
            except Exception:
                pass
            return result
