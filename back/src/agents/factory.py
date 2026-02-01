import logging
import os

from typing import List, Optional

from agno.agent import Agent
from agno.db.postgres import PostgresDb
from agno.knowledge import Knowledge
from agno.models.base import Model
from agno.vectordb.pgvector import PgVector

from src.agents.souper import SouperAgent
from src.models.safe_gemini import SafeGemini
from src.agents.genie import GenieAgent
from src.agents.list_agent import ListAgent
# from src.agents.rag import RagAgent
# from src.agents.memoriser import MemoriserAgent
# from src.agents.mailer import MailerAgent
# from src.agents.briefing import BriefingAgent
# from src.agents.extractor import ExtractionAgent
# from src.agents.email_analyzer import EmailAnalyzerAgent
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
from src.knowledge.factory import build_knowledge_base, build_vector_db
from src.knowledge.user_knowledge import UserKnowledgeAdapter
from src.tools.config import ToolConfigClient
from src.tools.factory import build as build_tools, ToolsConfig
from src.tools.models import ToolSpec
from src.tools.scheduler import SchedulerTools
from agno.tools import Toolkit

logger = logging.getLogger(__name__)


class AgentRunWrapper:
    """
    Thin wrapper that injects knowledge_filters={"user_id": rag_user_id} into every
    run/arun call so agentic search is scoped to the user. Call sites do not need
    to pass knowledge_filters explicitly.
    """

    def __init__(self, agent: Agent, rag_user_id: str):
        self._agent = agent
        self._rag_user_id = rag_user_id

    def arun(self, input, **kwargs):
        filters = kwargs.get("knowledge_filters") or {}
        if isinstance(filters, dict):
            filters = {**filters, "user_id": self._rag_user_id}
        kwargs["knowledge_filters"] = filters
        return self._agent.arun(input, **kwargs)

    def run(self, input, **kwargs):
        filters = kwargs.get("knowledge_filters") or {}
        if isinstance(filters, dict):
            filters = {**filters, "user_id": self._rag_user_id}
        kwargs["knowledge_filters"] = filters
        return self._agent.run(input, **kwargs)

    def __getattr__(self, name):
        return getattr(self._agent, name)


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
        self._vector_db: Optional[PgVector] = None  # Legacy; prefer _knowledge
        self._knowledge: Optional[Knowledge] = None  # Shared Agno Knowledge (lazy)

    @property
    def config_client(self) -> ToolConfigClient:
        """Доступ к ToolConfigClient для запроса инструментов."""
        return self._config_client

    def _get_or_create_vector_db(self) -> Optional[PgVector]:
        """Lazy initialization of shared Vector DB instance (used when building Knowledge)."""
        if self._vector_db is None:
            try:
                self._vector_db = build_vector_db()
                logger.info("[Factory] Vector DB initialized successfully")
            except Exception as e:
                logger.error(
                    "[Factory] Failed to initialize Vector DB: %s", e, exc_info=True
                )
        return self._vector_db

    def _get_or_create_knowledge(self) -> Optional[Knowledge]:
        """Lazy initialization of shared Knowledge (vector_db + contents_db)."""
        if self._knowledge is None:
            try:
                self._knowledge = build_knowledge_base()
                logger.info("[Factory] Shared Knowledge initialized")
            except Exception as e:
                logger.error(
                    "[Factory] Failed to initialize Knowledge: %s", e, exc_info=True
                )
        return self._knowledge

    def get_knowledge(self) -> Optional[Knowledge]:
        """Return shared Knowledge for insert/delete (callers pass user_id in metadata)."""
        return self._get_or_create_knowledge()

    # ... (build_model omitted)

    def build_model(
        self,
        model_name: str,
        *,
        provider: str | None = None,
        web_search: bool = False,
        thinking: str = "off",
        endpoint: str | None = None,
    ) -> Model:
        """Build a model instance from model name.

        Args:
            model_name: Name of the model (e.g., 'gemini-2.0-flash', 'gemini-1.5-pro')
            web_search: If True, enable native Gemini search grounding
            thinking: Thinking level ("off", "low", "medium", "high")
            endpoint: Optional full API endpoint URL (overrides provider default base_url).

        Returns:
            Model instance

        Raises:
            ValueError: If model name is not supported
        """
        # Normalize provider if explicitly provided
        provider_norm = (provider or "").strip().lower() or None

        # Support Gemini and Gemma models
        if (
            provider_norm == "google"
            or model_name.startswith("gemini-")
            or model_name.startswith("gemma-")
        ):
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

        # Support OpenCode models (base_url from config endpoint, no hardcoding).
        # gpt-5-nano uses Responses API (/v1/responses); big-pickle uses Chat Completions (/v1/chat/completions).
        elif provider_norm == "opencode" or model_name in ["big-pickle", "gpt-5-nano"]:
            api_key = os.getenv("OPENCODE_API_KEY")
            if not api_key:
                raise ValueError("OPENCODE_API_KEY environment variable not set")

            # Prefer endpoint from config (payload). Normalize: strip trailing slash and
            # if full .../chat/completions or .../responses URL, use base only.
            if endpoint and endpoint.strip():
                ep = endpoint.strip().rstrip("/")
                if ep.endswith("chat/completions"):
                    base_url = ep[: -len("chat/completions")].rstrip("/")
                    use_responses_api = False
                elif ep.endswith("responses"):
                    base_url = ep[: -len("responses")].rstrip("/")
                    use_responses_api = True
                else:
                    base_url = ep
                    use_responses_api = False
            else:
                base_url = "https://opencode.ai/zen/v1"  # fallback for legacy configs
                use_responses_api = False

            # Send model name without opencode/ prefix — API expects e.g. "big-pickle" or "gpt-5-nano"
            if use_responses_api:
                from agno.models.openai import OpenAIResponses

                logger.info(
                    "[Factory] Creating OpenCode model (Responses API): %s (base_url=%s)",
                    model_name,
                    base_url,
                )
                return OpenAIResponses(
                    id=model_name,
                    api_key=api_key,
                    base_url=base_url,
                )
            from agno.models.openai import OpenAIChat

            logger.info(
                "[Factory] Creating OpenCode model (Chat Completions): %s (base_url=%s)",
                model_name,
                base_url,
            )
            return OpenAIChat(
                id=model_name,
                api_key=api_key,
                base_url=base_url,
            )

        # Support OpenRouter models (base_url from config endpoint, no hardcoding)
        elif (
            provider_norm == "openrouter"
            or provider_norm == "openrouter.ai"
            or provider_norm == "openrouter_ai"
        ) or (
            "/" in model_name
            and not model_name.startswith("gemini-")
            and not model_name.startswith("gemma-")
        ):
            api_key = os.getenv("OPENROUTER_API_KEY")
            if not api_key:
                raise ValueError("OPENROUTER_API_KEY environment variable not set")

            from agno.models.openai import OpenAIChat

            # Prefer endpoint from config (payload)
            if endpoint and endpoint.strip():
                ep = endpoint.strip().rstrip("/")
                if ep.endswith("chat/completions"):
                    base_url = ep[: -len("chat/completions")].rstrip("/")
                else:
                    base_url = ep
            else:
                base_url = "https://openrouter.ai/api/v1"  # fallback for legacy configs
            logger.info(
                "[Factory] Creating OpenRouter model: %s (base_url=%s)",
                model_name,
                base_url,
            )
            return OpenAIChat(
                id=model_name,
                api_key=api_key,
                base_url=base_url,
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
        endpoint: Optional[str] = None,
    ) -> Agent:
        # Use provided model or default
        # If command_desc has model, use it if model_name is not provided
        if not model_name and command_desc and command_desc.get("model"):
            model_name = command_desc["model"]

        model = (
            self.build_model(
                model_name,
                web_search=web_search,
                thinking=thinking,
                endpoint=endpoint,
            )
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

        list_id = command_desc.get("list_id") if command_desc else None

        tools: List[Toolkit] = []

        # List agent: only list tools (knowledge_search with list_id), no web_search
        if agent_type and agent_type.lower() == "list" and user_id:
            config = ToolsConfig()
            params = {"user_id": user_id, "list_id": list_id}
            if command_desc and command_desc.get("auth_token"):
                params["auth_token"] = command_desc["auth_token"]
            config.add("knowledge_search", **params)
            try:
                tools = await build_tools(config)
                logger.info("[Factory] Built %d tools for ListAgent", len(tools))
            except Exception as e:
                logger.warning("[Factory] Failed to build list tools: %s", e)
        # If user_id provided but no tools_specs, fetch tools from config_client
        elif not tools_specs and user_id:
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
                    params = dict(tool_spec.params)
                    # Inject command_desc auth_token and list_id for knowledge_search (list chat)
                    if tool_spec.name == "knowledge_search" and command_desc:
                        if "auth_token" not in params and command_desc.get(
                            "auth_token"
                        ):
                            params["auth_token"] = command_desc["auth_token"]
                        if "list_id" not in params and command_desc.get("list_id"):
                            params["list_id"] = command_desc["list_id"]
                    config.add(tool_spec.name, **params)
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
            # Shared Agno Knowledge; user isolation via knowledge_filters at run()
            # and UserKnowledgeAdapter so update_knowledge stores with user_id
            knowledge = self._get_or_create_knowledge()
            if knowledge:
                knowledge = UserKnowledgeAdapter(knowledge, rag_user_id)
            else:
                logger.warning(
                    "[Factory] Knowledge not available, agent will not have memory"
                )

            if command_desc and command_desc.get("type"):
                agent_type = command_desc["type"]
            # List chat: list_id takes precedence so we use ListAgent
            if list_id:
                agent_type = "list"
                logger.info(
                    "[Factory] List chat detected, building ListAgent for list_id=%s",
                    list_id,
                )
            # if agent_type and agent_type.lower() == "list":
            #     agent = ListAgent(
            #         db=self._db,
            #         model=model,
            #         tools=tools,
            #         debug_mode=self._debug_mode,
            #         knowledge=knowledge,
            #         list_id=list_id,
            #         user_id=rag_user_id,
            #         learning=True,
            #     )
            #     logger.info("[Factory] Built ListAgent for list_id=%s", list_id)
            # elif agent_type and agent_type.lower() == "mailer":
            #     agent = MailerAgent(
            #         db=self._db,
            #         model=model,
            #         tools=tools,
            #         debug_mode=self._debug_mode,
            #         knowledge=knowledge,
            #         user_id=rag_user_id,
            #         learning=True,
            #     )
            # elif agent_type and agent_type.lower() == "rag":
            #     agent = RagAgent(
            #         db=self._db,
            #         model=model,
            #         tools=tools,
            #         debug_mode=self._debug_mode,
            #         knowledge=knowledge,
            #         user_id=rag_user_id,
            #         learning=True,
            #     )
            # elif agent_type and agent_type.lower() == "memoriser":
            #     agent = MemoriserAgent(
            #         db=self._db,
            #         model=model,
            #         tools=tools,
            #         debug_mode=self._debug_mode,
            #         knowledge=knowledge,
            #         user_id=rag_user_id,
            #         learning=True,
            #     )
            # elif agent_type and agent_type.lower() == "briefing":
            #     agent = BriefingAgent(
            #         model=model,
            #         db=self._db,
            #         knowledge=knowledge,
            #         tools=tools,
            #         debug_mode=self._debug_mode,
            #         user_id=rag_user_id,
            #         learning=True,
            #     )
            # elif agent_type and agent_type.lower() == "extraction":
            #     agent = ExtractionAgent(
            #         model=model,
            #         db=self._db,
            #         debug_mode=self._debug_mode,
            #         user_id=rag_user_id,
            #         learning=True,
            #     )
            # elif agent_type and agent_type.lower() == "email_analyzer":
            #     agent = EmailAnalyzerAgent(
            #         model=model,
            #         db=self._db,
            #         debug_mode=self._debug_mode,
            #         user_id=rag_user_id,
            #         learning=True,
            #     )
            # elif agent_type and agent_type.lower() == "analyst":
            #     # NOTE: output_schema removed - Gemini 2.5 doesn't support function calling with response_mime_type: application/json
            #     agent = WorkflowAgent(
            #         name="Analyst",
            #         model=model,
            #         instructions=analyst_instructions.format(
            #             project_id="unknown", task_id="unknown"
            #         ),
            #         markdown=True,
            #         debug_mode=self._debug_mode,
            #         tools=tools,
            #         workflow_storage=None,
            #         on_completion=None,
            #         tool_call_limit=10,
            #         user_id=rag_user_id,
            #         learning=True,
            #         db=self._db,
            #     )
            # elif agent_type and agent_type.lower() == "architect":
            #     # NOTE: output_schema removed - Gemini 2.5 doesn't support function calling with response_mime_type: application/json
            #     agent = WorkflowAgent(
            #         name="Architect",
            #         model=model,
            #         tools=tools,
            #         instructions=architect_instructions,
            #         markdown=True,
            #         debug_mode=self._debug_mode,
            #         workflow_storage=None,
            #         on_completion=None,
            #         tool_call_limit=10,
            #         user_id=rag_user_id,
            #         learning=True,
            #         db=self._db,
            #     )
            # elif agent_type and agent_type.lower() == "developer":
            #     agent = WorkflowAgent(
            #         name="Developer",
            #         model=model,
            #         tools=tools,
            #         instructions=developer_instructions,
            #         markdown=True,
            #         debug_mode=self._debug_mode,
            #         workflow_storage=None,
            #         on_completion=None,
            #         tool_call_limit=20,
            #         user_id=rag_user_id,
            #         learning=True,
            #         db=self._db,
            #     )
            # elif agent_type and agent_type.lower() == "worker":
            #     agent = WorkflowAgent(
            #         name="Worker",
            #         model=model,
            #         tools=tools,
            #         instructions=worker_instructions,
            #         markdown=True,
            #         debug_mode=self._debug_mode,
            #         workflow_storage=None,
            #         on_completion=None,
            #         tool_call_limit=10,
            #         user_id=rag_user_id,
            #         learning=True,
            #         db=self._db,
            #     )
            # elif agent_type and agent_type.lower() == "reviewer":
            #     # NOTE: output_schema removed - Gemini 2.5 doesn't support function calling with response_mime_type: application/json
            #     agent = WorkflowAgent(
            #         name="Reviewer",
            #         model=model,
            #         instructions=reviewer_instructions,
            #         markdown=True,
            #         debug_mode=self._debug_mode,
            #         workflow_storage=None,
            #         on_completion=None,
            #         tool_call_limit=10,
            #         user_id=rag_user_id,
            #         learning=True,
            #         db=self._db,
            #     )
            # else:
            #     # Default to Genie
            #     # Default to Genie
            #
            #     # Default to Genie
            #
            #     # Add Timezone Context
            #     genie_instructions = None
            #     add_datetime = True
            #
            #     # Determine timezone to use
            #     if timezone:
            #         try:
            #             from zoneinfo import ZoneInfo
            #             from datetime import datetime
            #
            #             # Use ZoneInfo from standard library
            #             tz = ZoneInfo(timezone)
            #             local_time = datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S %Z")
            #
            #             from src.agents.genie import BASE_INSTRUCTIONS
            #
            #             genie_instructions = (
            #                 f"Current User Time: {local_time} ({timezone}).\nUse this time for all relative time calculations (e.g. 'in one hour').\n\n"
            #                 + BASE_INSTRUCTIONS
            #             )
            #             add_datetime = False  # Disable default UTC datetime
            #             logger.info(
            #                 f"[Factory] Injected local time: {local_time} for timezone: {timezone}"
            #             )
            #         except Exception as e:
            #             logger.warning("Failed to parse timezone %s: %s", timezone, e)
            #     elif timezone_offset:
            #         try:
            #             from datetime import (
            #                 datetime,
            #                 timedelta,
            #                 timezone as dt_timezone,
            #             )
            #
            #             # timezone_offset is in minutes from UTC (e.g. -120 for GMT+2 in JS getTimezoneOffset() returns positive for West, negative for East?
            #             # Wait, JS new Date().getTimezoneOffset() returns positive minutes for zones West of UTC, negative for East.
            #             # e.g. UTC+2 returns -120.
            #             # Python timezone(timedelta(minutes=...)) expects offset from UTC.
            #             # So we need to negate JS offset.
            #             offset_mins = int(timezone_offset)
            #             # Invert sign because JS returns (UTC - Local) in minutes, Python wants (Local - UTC)
            #             tz_offset = timedelta(minutes=-offset_mins)
            #             tz = dt_timezone(tz_offset)
            #
            #             local_time = datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S %z")
            #
            #             from src.agents.genie import BASE_INSTRUCTIONS
            #
            #             genie_instructions = (
            #                 f"Current User Time: {local_time} (UTC offset {tz_offset}).\nUse this time for all relative time calculations (e.g. 'in one hour').\n\n"
            #                 + BASE_INSTRUCTIONS
            #             )
            #             add_datetime = False
            #             logger.info(
            #                 f"[Factory] Injected local time: {local_time} for offset: {offset_mins}"
            #             )
            #         except Exception as e:
            #             logger.warning(
            #                 "Failed to use timezone_offset %s: %s", timezone_offset, e
            #             )
            #
            #     agent = GenieAgent(
            #         db=self._db,
            #         model=model,
            #         tools=tools,
            #         debug_mode=self._debug_mode,
            #         thinking=thinking,
            #         knowledge=knowledge,
            #         instructions=genie_instructions,  # Pass combined or None (GenieAgent defaults to BASE)
            #         user_id=rag_user_id,
            #         learning=True,
            #     )
            #
            #     if not add_datetime:
            #         agent.add_datetime_to_context = False

            agent = SouperAgent(
                db=self._db,
                model=model,
                tools=tools,
                debug_mode=self._debug_mode,
                thinking=thinking,
                knowledge=knowledge,
                # instructions=genie_instructions,  # Pass combined or None (GenieAgent defaults to BASE)
                user_id=rag_user_id,
                learning=True,
            )

            # _attach_tool_context removed - ChatHistoryTool is disabled
            # self._attach_tool_context(agent, tools)
            logger.info(
                "[WS] Agent created successfully: session_id=%s type=%s",
                session_id,
                agent.name,
            )
            return AgentRunWrapper(agent, rag_user_id)
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
