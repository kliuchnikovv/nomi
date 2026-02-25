import logging
import os
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from agno.agent import Agent
from agno.db.postgres import PostgresDb
from agno.knowledge import Knowledge
from agno.models.base import Model
from agno.vectordb.pgvector import PgVector

from src.agents.souper import SouperAgent
from src.models.safe_gemini import SafeGemini

from src.tools.config import ToolConfigClient
from src.tools.factory import ToolsConfig
from src.tools.models import ToolSpec
from agno.tools import Toolkit

logger = logging.getLogger(__name__)


class AgentRunWrapper:
    """
    Thin wrapper that injects knowledge_filters={"user_id": rag_user_id} into every
    run/arun call so agentic search is scoped to the user. Call sites do not need
    to pass knowledge_filters explicitly.

    arun() implements the two-arun pattern:
      - Run 1: Only DiscoveryToolkit is visible; agent calls discover_tools() which
               adds actual tools to the agent and sets agent._discovery_done = True.
      - Run 2: All discovered tools are now registered; agent executes the real task.
    If discovery does not happen (pure knowledge question), run-1 output is yielded
    directly without a second run.
    """

    def __init__(self, agent: Agent, rag_user_id: str):
        self._agent = agent
        self._rag_user_id = rag_user_id

    async def arun(self, input, **kwargs) -> AsyncIterator:  # type: ignore[override]
        filters = kwargs.get("knowledge_filters") or {}
        if isinstance(filters, dict):
            filters = {**filters, "user_id": self._rag_user_id}
        kwargs["knowledge_filters"] = filters

        # Reset discovery state before run
        self._agent._discovery_done = False

        # Run 1: only DiscoveryToolkit visible (or no discovery needed).
        # Buffer run-1 output — only yield if discovery did NOT happen.
        run1_chunks = []
        async for chunk in self._agent.arun(input, **kwargs):
            run1_chunks.append(chunk)

        if not getattr(self._agent, "_discovery_done", False):
            # No discovery happened — pure knowledge/reasoning question.
            # Yield run-1 output directly.
            for chunk in run1_chunks:
                yield chunk
            return

        # Discovery happened: run-2 with discovered tools now visible.
        logger.debug(
            "[AgentRunWrapper] Discovery done, starting run-2 with discovered tools"
        )
        self._agent._discovery_done = False

        # Clear in-memory messages from run-1 to avoid polluting context.
        if hasattr(self._agent, "memory") and self._agent.memory:
            try:
                self._agent.memory.messages = []
            except Exception:
                pass

        async for chunk in self._agent.arun(input, **kwargs):
            yield chunk

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
        self._vector_db: PgVector | None = None  # Legacy; prefer _knowledge
        self._knowledge: Knowledge | None = None  # Shared Agno Knowledge (lazy)

    @property
    def config_client(self) -> ToolConfigClient:
        """Access to ToolConfigClient for requesting tools."""
        return self._config_client

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
        tools_specs: list[ToolSpec] | None = None,
        model_name: str | None = None,
        agent_type: str | None = None,
        command_desc: dict | None = None,
        web_search: bool = False,
        thinking: str = "off",
        user_id: str | None = None,
        chat_id: str | None = None,
        timezone: str | None = None,
        timezone_offset: str | None = None,
        endpoint: str | None = None,
        client_tool_runner: Callable[[str, str, dict], Awaitable[str]] | None = None,
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

        list_id = command_desc.get("list_id") if command_desc else None

        tools: list[Toolkit | Any] = []
        config_used: ToolsConfig | None = None

        # List agent: only list tools (knowledge_search with list_id), no web_search
        if agent_type and agent_type.lower() == "list" and user_id:
            config = ToolsConfig()
            params = {"user_id": user_id, "list_id": list_id}
            if command_desc and command_desc.get("auth_token"):
                params["auth_token"] = command_desc["auth_token"]
            config.add("knowledge_search", **params)
            config_used = config
        # If user_id provided but tools_specs is None (not passed), fetch tools from config_client
        # Note: empty list [] means no tools from frontend, don't fetch from API
        elif tools_specs is None and user_id:
            try:
                logger.debug("[Factory] Fetching tools for user_id=%s", user_id)
                tools_config = await self._config_client.fetch_tools(user_id=user_id)
                config_used = tools_config
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
            except Exception as e:
                logger.warning(
                    "[Factory] Failed to fetch tools for user %s: %s", user_id, e
                )
                # Continue with empty tools list
        elif tools_specs:
            # Build tools from provided specs
            logger.debug("[WS] tools: %s", [(t.name, t.enabled) for t in tools_specs])
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
                    config.add(tool_spec.name, provider=tool_spec.provider, **params)
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

            config_used = config

        # Setup RAG User ID: use user_id if explicit, or session_id if anonymous
        rag_user_id = user_id or session_id

        # Build catalog and DiscoveryToolkit from config (lazy tool loading via discovery)
        from src.tools.catalog import build_catalog
        from src.tools.discovery import DiscoveryToolkit

        discovery_toolkit: DiscoveryToolkit | None = None
        agent_tools: list[Toolkit | Any]

        if config_used and config_used.entries:
            catalog = build_catalog(config_used)
            discovery_toolkit = DiscoveryToolkit(
                catalog=catalog,
                config=config_used,
                sub_agent_model=model,
                client_tool_runner=client_tool_runner,
            )
            agent_tools = [discovery_toolkit]
            logger.info(
                "[Factory] Built DiscoveryToolkit with %d catalog entries",
                len(catalog.entries),
            )
        else:
            # No config — anonymous user with no tools; pass empty list directly
            agent_tools = tools

        logger.info(
            "[WS] Building agent: session_id=%s rag_user_id=%s model=%s agent_type=%s catalog_entries=%d",
            session_id,
            rag_user_id,
            model_name or "default",
            agent_type or "genie",
            len(config_used.entries) if config_used else len(agent_tools),
        )

        try:
            if command_desc and command_desc.get("type"):
                agent_type = command_desc["type"]
            # List chat: list_id takes precedence so we use ListAgent
            if list_id:
                agent_type = "list"
                logger.info(
                    "[Factory] List chat detected, building ListAgent for list_id=%s",
                    list_id,
                )

            agent = SouperAgent(
                db=self._db,
                model=model,
                tools=agent_tools,
                debug_mode=self._debug_mode,
                thinking=thinking,
                user_id=rag_user_id,
                timezone=timezone,
            )

            if discovery_toolkit is not None:
                discovery_toolkit.set_parent_agent(agent)

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
