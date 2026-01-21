import logging
import os

from typing import List, Optional
from agno.agent import Agent
from agno.db.postgres import PostgresDb
from agno.models.base import Model
from agno.vectordb.pgvector import PgVector

from src.models.safe_gemini import SafeGemini
from src.agents.genie import GenieAgent
from src.agents.rag import RagAgent
from src.agents.memoriser import MemoriserAgent
from src.agents.mailer import MailerAgent
from src.agents.briefing import BriefingAgent
from src.agents.extractor import ExtractionAgent
from src.agents.email_analyzer import EmailAnalyzerAgent
from src.workflow.agent import WorkflowAgent
from src.teams.development.team import (
    analyst_instructions,
    architect_instructions,
    developer_instructions,
    reviewer_instructions,
    worker_instructions,
)

# NOTE: AnalystOutput, ArchitectPlan, ReviewVerdict imports removed
# Gemini 2.5 doesn't support output_schema with function calling
from src.knowledge.factory import build_vector_db
from src.knowledge.user_knowledge import UserScopedKnowledge
from src.tools.config import ToolConfigClient
from src.tools.factory import build as build_tools, ToolsConfig
from src.tools.models import ToolSpec
from src.tools.scheduler import SchedulerTools
from agno.tools import Toolkit

logger = logging.getLogger(__name__)

# ...


class AgentFactory:
    def __init__(
        self,
        db: PostgresDb | None,
        model: Model,
        config_client: ToolConfigClient,
        *,
        debug_mode: bool = False,
    ):
        self._db = db
        self._model = model
        self._config_client = config_client
        self._debug_mode = debug_mode
        self._vector_db: Optional[PgVector] = (
            None  # Lazy initialization of DB connection
        )

    @property
    def config_client(self) -> ToolConfigClient:
        """Доступ к ToolConfigClient для запроса инструментов."""
        return self._config_client

    def _get_or_create_vector_db(self) -> Optional[PgVector]:
        """Lazy initialization of shared Vector DB instance."""
        if self._vector_db is None:
            try:
                self._vector_db = build_vector_db()
                logger.info("[Factory] Vector DB initialized successfully")
            except Exception as e:
                logger.error(
                    "[Factory] Failed to initialize Vector DB: %s", e, exc_info=True
                )
        return self._vector_db

    # ... (build_model omitted)

    def build_model(
        self, model_name: str, web_search: bool = False, thinking: str = "off"
    ) -> Model:
        """Build a model instance from model name.

        Args:
            model_name: Name of the model (e.g., 'gemini-2.0-flash', 'gemini-1.5-pro')
            web_search: If True, enable native Gemini search grounding
            thinking: Thinking level ("off", "low", "medium", "high")

        Returns:
            Model instance

        Raises:
            ValueError: If model name is not supported
        """
        # Support Gemini and Gemma models
        if model_name.startswith("gemini-") or model_name.startswith("gemma-"):
            api_key = os.getenv("GOOGLE_API_KEY")
            if not api_key:
                raise ValueError("GOOGLE_API_KEY environment variable not set")

            # Configure thinking mode for supported models (Gemini 2.5 Pro/Flash)
            thinking_budget = None
            include_thoughts = False

            if thinking and thinking != "off":
                # Defaults
                thinking_budget = 8192

                if thinking == "low":
                    thinking_budget = 2048
                elif thinking == "medium":
                    thinking_budget = 8192
                elif thinking == "high":
                    thinking_budget = 32768  # Max for Gemini 2.0 Flash Thinking

                include_thoughts = True
                logger.info(
                    "[Factory] Enabling thinking mode for model: %s (level=%s, budget=%d)",
                    model_name,
                    thinking,
                    thinking_budget,
                )

            # Use SafeGemini to filter empty parts and prevent 400 errors
            return SafeGemini(
                id=model_name,
                api_key=api_key,
                search=web_search,
                thinking_budget=thinking_budget,
                include_thoughts=include_thoughts,
            )

        # Add support for other providers as needed
        raise ValueError(f"Unsupported model: {model_name}")

    async def build(
        self,
        session_id: str,
        tools_specs: Optional[List[ToolSpec]] = None,
        model_name: Optional[str] = None,
        agent_type: Optional[str] = None,
        command_desc: Optional[dict] = None,
        web_search: bool = False,
        thinking: str = "off",
        user_id: Optional[str] = None,
        chat_id: Optional[str] = None,
        timezone: Optional[str] = None,
        timezone_offset: Optional[str] = None,
    ) -> Agent:
        # Use provided model or default
        # If command_desc has model, use it if model_name is not provided
        if not model_name and command_desc and command_desc.get("model"):
            model_name = command_desc["model"]

        model = (
            self.build_model(model_name, web_search=web_search, thinking=thinking)
            if model_name
            else self._model
        )

        # ... (Tool fetching logic unchanged) ...
        # NOTE: Since I am replacing a huge chunk, I need to be careful to include the tools logic or skip it if I can target specific lines.
        # But wait, the file content shows `tools` fetching is before this.
        # I only need to change the `build` method signature and the agent creation part.
        # This implementation below is targeting the method signature and skipping to the end where agent is created.

        # ... (Skipping tools fetching logic for brevity in replace block if possible, but replace_file_content works on contiguous blocks)
        # It's better to do 2 separate edits: 1 for signature, 1 for logic.
        pass

        # Splitting into two calls for safety. First call: Update signature.

        tools: List[Toolkit] = []

        # If user_id provided but no tools_specs, fetch tools from config_client
        if not tools_specs and user_id:
            try:
                logger.debug("[Factory] Fetching tools for user_id=%s", user_id)
                tools_config = await self._config_client.fetch_tools(user_id=user_id)
                logger.info(
                    "[Factory] Fetched %d tools for user %s",
                    len(tools_config.entries),
                    user_id,
                )

                # Add web search tool if supported
                if model_name and model_name.startswith("gemma-"):
                    logger.info(
                        "[Factory] Skipping web_search for Gemma model %s", model_name
                    )
                else:
                    tools_config.add("web_search")
                    logger.info("[Factory] Added web search tool")

                tools = await build_tools(tools_config)
            except Exception as e:
                logger.warning(
                    "[Factory] Failed to fetch tools for user %s: %s", user_id, e
                )
                # Continue with empty tools list
        elif tools_specs:
            # Build tools from provided specs
            logger.debug("[WS] tools: %s", [t.name for t in tools_specs])
            config = ToolsConfig()
            for tool_spec in tools_specs:
                if tool_spec.enabled:
                    config.add(tool_spec.name, **tool_spec.params)
                    logger.debug("[WS] tool appended: enabled")
                else:
                    logger.debug("[WS] tool not appended: not enabled")

            # Add web search tool if supported (Gemini only, not Gemma)
            if model_name and model_name.startswith("gemma-"):
                logger.info(
                    "[WS] Skipping web_search for Gemma model %s (tools not supported)",
                    model_name,
                )
            else:
                config.add("web_search")
                logger.info("[WS] Added web search tool (always enabled)")

            tools = await build_tools(config)

        # Capture built tools BEFORE adding SchedulerTools (to avoid including it in saved tools)
        # We pass the actual Toolkit objects, not ToolSpec configs
        tools_for_scheduler = list(tools) if tools else []

        # Always add SchedulerTools for Genie (except for Gemma)
        if not agent_type or agent_type.lower() == "genie":
            if model_name and model_name.startswith("gemma-"):
                logger.info(
                    "[WS] Skipping SchedulerTools for Gemma model %s (tools not supported)",
                    model_name,
                )
            else:
                # Pass user_id, chat_id, AND built tools to SchedulerTools
                tools.append(
                    SchedulerTools(
                        user_id=user_id, chat_id=chat_id, tools_list=tools_for_scheduler
                    )
                )

                # Add ClientUITools (Always enabled for Genie)
                from src.tools.ui import ClientUITools

                tools.append(ClientUITools())
                logger.info("[WS] Added ClientUITools to GenieAgent")

        # Setup RAG User ID: use user_id if explicit, or session_id if anonymous
        rag_user_id = user_id or session_id

        logger.debug("[WS] tools: %s", [t.name for t in tools])
        logger.info(
            "[WS] Building agent: session_id=%s rag_user_id=%s model=%s agent_type=%s tools_count=%d",
            session_id,
            rag_user_id,
            model_name or "default",
            agent_type or "genie",
            len(tools),
        )

        try:
            # Build User-Scoped Knowledge Base
            vector_db = self._get_or_create_vector_db()
            knowledge = None
            if vector_db:
                # Create a lightweight Knowledge wrapper for this user
                knowledge = UserScopedKnowledge(
                    user_id=rag_user_id, vector_db=vector_db
                )

            if command_desc and command_desc.get("type"):
                agent_type = command_desc["type"]
            if agent_type and agent_type.lower() == "mailer":
                agent = MailerAgent(
                    db=self._db,
                    model=model,
                    tools=tools,
                    debug_mode=self._debug_mode,
                )
            elif agent_type and agent_type.lower() == "rag":
                agent = RagAgent(
                    db=self._db,
                    model=model,
                    tools=tools,
                    debug_mode=self._debug_mode,
                    knowledge=knowledge,
                )
            elif agent_type and agent_type.lower() == "memoriser":
                agent = MemoriserAgent(
                    db=self._db,
                    model=model,
                    tools=tools,
                    debug_mode=self._debug_mode,
                    knowledge=knowledge,
                )
            elif agent_type and agent_type.lower() == "briefing":
                agent = BriefingAgent(
                    model=model,
                    knowledge=knowledge,
                    tools=tools,
                    debug_mode=self._debug_mode,
                )
            elif agent_type and agent_type.lower() == "extraction":
                agent = ExtractionAgent(
                    model=model,
                    debug_mode=self._debug_mode,
                )
            elif agent_type and agent_type.lower() == "email_analyzer":
                agent = EmailAnalyzerAgent(
                    model=model,
                    debug_mode=self._debug_mode,
                )
            elif agent_type and agent_type.lower() == "analyst":
                # NOTE: output_schema removed - Gemini 2.5 doesn't support function calling with response_mime_type: application/json
                agent = WorkflowAgent(
                    name="Analyst",
                    model=model,
                    instructions=analyst_instructions.format(
                        project_id="unknown", task_id="unknown"
                    ),
                    markdown=True,
                    debug_mode=self._debug_mode,
                    tools=tools,
                    workflow_storage=None,
                    on_completion=None,
                    tool_call_limit=10,
                )
            elif agent_type and agent_type.lower() == "architect":
                # NOTE: output_schema removed - Gemini 2.5 doesn't support function calling with response_mime_type: application/json
                agent = WorkflowAgent(
                    name="Architect",
                    model=model,
                    tools=tools,
                    instructions=architect_instructions,
                    markdown=True,
                    debug_mode=self._debug_mode,
                    workflow_storage=None,
                    on_completion=None,
                    tool_call_limit=10,
                )
            elif agent_type and agent_type.lower() == "developer":
                agent = WorkflowAgent(
                    name="Developer",
                    model=model,
                    tools=tools,
                    instructions=developer_instructions,
                    markdown=True,
                    debug_mode=self._debug_mode,
                    workflow_storage=None,
                    on_completion=None,
                    tool_call_limit=20,
                )
            elif agent_type and agent_type.lower() == "worker":
                agent = WorkflowAgent(
                    name="Worker",
                    model=model,
                    tools=tools,
                    instructions=worker_instructions,
                    markdown=True,
                    debug_mode=self._debug_mode,
                    workflow_storage=None,
                    on_completion=None,
                    tool_call_limit=10,
                )
            elif agent_type and agent_type.lower() == "reviewer":
                # NOTE: output_schema removed - Gemini 2.5 doesn't support function calling with response_mime_type: application/json
                agent = WorkflowAgent(
                    name="Reviewer",
                    model=model,
                    instructions=reviewer_instructions,
                    markdown=True,
                    debug_mode=self._debug_mode,
                    workflow_storage=None,
                    on_completion=None,
                    tool_call_limit=10,
                )
            else:
                # Default to Genie
                # Default to Genie

                # Default to Genie

                # Add Timezone Context
                genie_instructions = None
                add_datetime = True

                # Determine timezone to use
                if timezone:
                    try:
                        from zoneinfo import ZoneInfo
                        from datetime import datetime

                        # Use ZoneInfo from standard library
                        tz = ZoneInfo(timezone)
                        local_time = datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S %Z")

                        from src.agents.genie import BASE_INSTRUCTIONS

                        genie_instructions = (
                            f"Current User Time: {local_time} ({timezone}).\nUse this time for all relative time calculations (e.g. 'in one hour').\n\n"
                            + BASE_INSTRUCTIONS
                        )
                        add_datetime = False  # Disable default UTC datetime
                        logger.info(
                            f"[Factory] Injected local time: {local_time} for timezone: {timezone}"
                        )
                    except Exception as e:
                        logger.warning("Failed to parse timezone %s: %s", timezone, e)
                elif timezone_offset:
                    try:
                        from datetime import (
                            datetime,
                            timedelta,
                            timezone as dt_timezone,
                        )

                        # timezone_offset is in minutes from UTC (e.g. -120 for GMT+2 in JS getTimezoneOffset() returns positive for West, negative for East?
                        # Wait, JS new Date().getTimezoneOffset() returns positive minutes for zones West of UTC, negative for East.
                        # e.g. UTC+2 returns -120.
                        # Python timezone(timedelta(minutes=...)) expects offset from UTC.
                        # So we need to negate JS offset.
                        offset_mins = int(timezone_offset)
                        # Invert sign because JS returns (UTC - Local) in minutes, Python wants (Local - UTC)
                        tz_offset = timedelta(minutes=-offset_mins)
                        tz = dt_timezone(tz_offset)

                        local_time = datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S %z")

                        from src.agents.genie import BASE_INSTRUCTIONS

                        genie_instructions = (
                            f"Current User Time: {local_time} (UTC offset {tz_offset}).\nUse this time for all relative time calculations (e.g. 'in one hour').\n\n"
                            + BASE_INSTRUCTIONS
                        )
                        add_datetime = False
                        logger.info(
                            f"[Factory] Injected local time: {local_time} for offset: {offset_mins}"
                        )
                    except Exception as e:
                        logger.warning(
                            "Failed to use timezone_offset %s: %s", timezone_offset, e
                        )

                agent = GenieAgent(
                    db=self._db,
                    model=model,
                    tools=tools,
                    debug_mode=self._debug_mode,
                    thinking=thinking,
                    knowledge=knowledge,
                    instructions=genie_instructions,  # Pass combined or None (GenieAgent defaults to BASE)
                )

                if not add_datetime:
                    agent.add_datetime_to_context = False

            # _attach_tool_context removed - ChatHistoryTool is disabled
            # self._attach_tool_context(agent, tools)
            logger.info(
                "[WS] Agent created successfully: session_id=%s type=%s",
                session_id,
                agent.name,
            )
            return agent
        except Exception as e:
            logger.error(
                "[WS] Failed to create agent: session_id=%s model=%s agent_type=%s error=%s",
                session_id,
                model_name or "default",
                agent_type or "genie",
                e,
                exc_info=True,
            )
            raise
