import json
import logging
import re
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from agno.db.postgres import PostgresDb
from agno.agent import Agent
from agno.memory.manager import MemoryManager
from agno.models.base import Model
from agno.models.message import Message
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
STALE_PREFIX = "[POSSIBLY STALE] "
STALE_THRESHOLD_DAYS = 180

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
- Do NOT call these proactively — memory is saved automatically after each response.

**Conflict avoidance (IMPORTANT):**
- Before calling `add_memory`, check `<memories_from_previous_interactions>` for any existing fact on the same topic.
- If an existing memory would become outdated or wrong by this new fact, call `update_memory(id, new_text)` on that memory_id — do NOT add a new conflicting entry.
- Example: stored memory "User likes coffee" + user now says "I quit coffee" → call `update_memory` to change it, not `add_memory`.
- Only call `add_memory` when no existing memory already covers the same factual domain."""


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
        session_id: str | None = None,
        num_history_runs: int = 6,
        enable_session_summaries: bool = False,
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
            session_id=session_id,
            num_history_runs=num_history_runs,
            enable_session_summaries=enable_session_summaries,
        )

    # ------------------------------------------------------------------
    # Memory deduplication
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_memory_text(text: str) -> str:
        """Normalize memory text for deduplication comparison."""
        if not text:
            return ""
        if text.startswith(STALE_PREFIX):
            text = text[len(STALE_PREFIX):]
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

    async def _resolve_memory_conflicts(self) -> int:
        """Use the agent's LLM to detect and remove semantically conflicting memories.

        Called after _deduplicate_memories(). Finds pairs of memories that cannot both
        be true (e.g. two different home cities, two different ages) and deletes the
        older / less-specific entry.

        Returns the number of memories deleted.
        """
        if not self.memory_manager or not self.user_id:
            return 0

        try:
            db = self.memory_manager.db
            if db is None:
                return 0

            memories = db.get_user_memories(user_id=self.user_id)
            if not memories or len(memories) < 2:
                return 0

            # Format numbered list for the LLM
            mem_lines = "\n".join(
                f"{i + 1}. [{getattr(m, 'memory_id', '?')}] {getattr(m, 'memory', str(m))}"
                for i, m in enumerate(memories)
            )

            prompt = (
                "You are a memory conflict detector. Below are facts stored about a user.\n"
                "Identify pairs where one fact CONTRADICTS or SUPERSEDES another — "
                "meaning both cannot be true simultaneously.\n\n"
                "Rules:\n"
                "- Only flag true factual conflicts (e.g. location, age, a preference that has changed)\n"
                "- Complementary or unrelated facts are NOT conflicts\n"
                "- For each conflict, mark the OLDER or less specific entry for deletion\n"
                "- Order within the list is newest-first; prefer keeping lower-numbered entries\n"
                "- Return ONLY valid JSON — an array of {\"delete\": \"<memory_id>\"} objects\n"
                "- If no conflicts exist, return []\n\n"
                f"Memories:\n{mem_lines}\n\n"
                "Respond only with the JSON array, no explanation."
            )

            model_response = await self.model.aresponse(
                messages=[Message(role="user", content=prompt)]
            )

            raw = (model_response.content or "").strip()

            # Extract JSON array even if the model wraps it in markdown fences
            json_match = re.search(r"\[.*?\]", raw, re.DOTALL)
            if not json_match:
                return 0

            deletions = json.loads(json_match.group())
            if not isinstance(deletions, list):
                return 0

            ids_to_delete = [
                entry["delete"]
                for entry in deletions
                if isinstance(entry, dict) and "delete" in entry and entry["delete"]
            ]

            if not ids_to_delete:
                return 0

            # Safety guard: never delete more than half the memory set at once
            max_deletions = max(1, len(memories) // 2)
            ids_to_delete = ids_to_delete[:max_deletions]

            try:
                db.delete_user_memories(ids_to_delete, user_id=self.user_id)
            except Exception:
                for mem_id in ids_to_delete:
                    try:
                        db.delete_user_memory(mem_id, user_id=self.user_id)
                    except Exception:
                        pass

            logger.info(
                "[Souper] Conflict resolution: deleted %d conflicting memories for user %s",
                len(ids_to_delete),
                self.user_id,
            )
            return len(ids_to_delete)

        except Exception as exc:
            logger.warning("[Souper] Memory conflict resolution failed: %s", exc)
            return 0

    async def _mark_stale_memories(self) -> int:
        """Prepend STALE_PREFIX to memories not updated in STALE_THRESHOLD_DAYS.

        Also strips the prefix from memories that were recently confirmed
        (updated_at refreshed by the agent calling update_memory).
        Returns the number of memories whose staleness state changed.
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

            now = time.time()
            cutoff = now - STALE_THRESHOLD_DAYS * 86400
            changed = 0

            for mem in memories:
                text = getattr(mem, "memory", "") or ""
                updated_at = getattr(mem, "updated_at", None)
                created_at = getattr(mem, "created_at", None)
                if updated_at is None and created_at is None:
                    continue
                last_touched = max(updated_at or 0, created_at or 0)
                is_stale = last_touched < cutoff
                already_marked = text.startswith(STALE_PREFIX)

                if is_stale and not already_marked:
                    mem.memory = STALE_PREFIX + text
                elif not is_stale and already_marked:
                    mem.memory = text[len(STALE_PREFIX):]
                else:
                    continue

                mem_id = getattr(mem, "memory_id", None)
                if not mem_id:
                    mem.memory = text  # restore on failure
                    continue

                try:
                    db.replace_user_memory(mem_id, mem)
                    changed += 1
                except Exception as exc:
                    logger.warning(
                        "[Souper] Failed to update staleness for memory %s: %s", mem_id, exc
                    )
                    mem.memory = text  # restore on failure

            if changed:
                logger.info(
                    "[Souper] Staleness: %d memories changed state for user %s",
                    changed,
                    self.user_id,
                )
            return changed

        except Exception as exc:
            logger.warning("[Souper] Memory staleness check failed: %s", exc)
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
            # Wrap the async generator to run dedup + conflict resolution after iteration completes
            async def _stream_with_dedup():
                try:
                    async for event in parent_arun:
                        yield event
                finally:
                    try:
                        await self._deduplicate_memories()
                    except Exception:
                        pass
                    try:
                        await self._resolve_memory_conflicts()
                    except Exception:
                        pass
            return _stream_with_dedup()
        else:
            result = await parent_arun
            try:
                await self._deduplicate_memories()
            except Exception:
                pass
            try:
                await self._resolve_memory_conflicts()
            except Exception:
                pass
            return result
