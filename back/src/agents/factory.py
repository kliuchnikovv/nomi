import json
import logging
import os
from collections.abc import Awaitable, Callable
from typing import Any

from agno.agent import Agent
from agno.db.postgres import PostgresDb
from agno.knowledge import Knowledge
from agno.models.base import Model
from agno.vectordb.pgvector import PgVector

from src.agents.nomi import NomiAgent
from src.agents.planner import build_planner_agent
from src.models.safe_gemini import SafeGemini

from src.tools.config import ToolConfigClient
from src.tools.discovery import build_discovery_tool
from src.tools.factory import build as build_tools, ToolsConfig
from src.tools.models import ToolSpec
from src.storage.backend import StorageBackend
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
        knowledge: Knowledge | None = None,
    ):
        self._db = db
        self._model = model
        self._config_client = config_client
        self._debug_mode = debug_mode
        self._vector_db: PgVector | None = None  # Legacy; prefer _knowledge
        self._knowledge: Knowledge | None = knowledge  # Shared Agno Knowledge

    @property
    def config_client(self) -> ToolConfigClient:
        """Access to ToolConfigClient for requesting tools."""
        return self._config_client

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
            from src.core.gemini_keys import KEY_MANAGER

            api_key = KEY_MANAGER.current()

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
                from src.models.safe_openai_responses import SafeOpenAIResponses

                logger.info(
                    "[Factory] Creating OpenCode model (Responses API): %s (base_url=%s)",
                    model_name,
                    base_url,
                )
                return SafeOpenAIResponses(
                    id=model_name,
                    api_key=api_key,
                    base_url=base_url,
                )
            else:
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

        # Support z.ai / GLM models (OpenAI-compatible API)
        # Must come BEFORE OpenRouter check since both use similar patterns
        elif (
            provider_norm == "z.ai"
            or provider_norm == "z-ai"
            or model_name.startswith("glm-")
        ):
            api_key = os.getenv("ZAI_API_KEY")
            if not api_key:
                raise ValueError("ZAI_API_KEY environment variable not set")

            from src.models.safe_openai import SafeOpenAI

            # Prefer endpoint from config (payload)
            if endpoint and endpoint.strip():
                ep = endpoint.strip().rstrip("/")
                if ep.endswith("chat/completions"):
                    base_url = ep[: -len("chat/completions")].rstrip("/")
                else:
                    base_url = ep
            else:
                base_url = "https://api.z.ai/api/coding/paas/v4"  # z.ai GLM API default endpoint
            logger.info(
                "[Factory] Creating z.ai GLM model: %s (base_url=%s)",
                model_name,
                base_url,
            )
            return SafeOpenAI(
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
            and not model_name.startswith("glm-")  # Exclude GLM (handled by z.ai)
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
        bot_identity: dict | None = None,
        user_location: str | None = None,
        single_chat_mode: bool = False,
        storage_backend: StorageBackend | None = None,
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

        if (
            os.getenv("USE_DISCOVERY_TOOL") == "1"
            and user_id
            and client_tool_runner
            and not (agent_type and agent_type.lower() == "list")
        ):
            # Discovery mode: single routing tool replaces all per-integration tools
            discovery_fn = build_discovery_tool(
                user_id=user_id,
                config_client=self._config_client,
                client_tool_runner=client_tool_runner,
            )
            tools = [discovery_fn]
            logger.info(
                "[Factory] Discovery mode: built discovery_tool for user=%s", user_id
            )
        else:
            # Legacy mode: unchanged existing code
            config_used: ToolsConfig | None = None

            # List agent: only list tools (knowledge_search with list_id), no web_search
            if agent_type and agent_type.lower() == "list" and user_id:
                config = ToolsConfig()
                params = {"user_id": user_id, "list_id": list_id}
                if command_desc and command_desc.get("auth_token"):
                    params["auth_token"] = command_desc["auth_token"]
                config.add("knowledge_search", **params)
                config_used = config
                try:
                    tools = await build_tools(config, user_id=user_id, knowledge=self._knowledge)
                    logger.info("[Factory] Built %d tools for ListAgent", len(tools))
                except Exception as e:
                    logger.warning("[Factory] Failed to build list tools: %s", e)
            # If user_id provided but no tools_specs, fetch tools from config_client
            elif not tools_specs and user_id:
                try:
                    logger.debug("[Factory] Fetching tools for user_id=%s", user_id)
                    tools_config = await self._config_client.fetch_tools(
                        user_id=user_id
                    )
                    config_used = tools_config
                    logger.info(
                        "[Factory] Fetched %d tools for user %s",
                        len(tools_config.entries),
                        user_id,
                    )

                    # Add web search tool if supported
                    if model_name and model_name.startswith("gemma-"):
                        logger.info(
                            "[Factory] Skipping web_search for Gemma model %s",
                            model_name,
                        )
                    else:
                        tools_config.add("web_search")
                        logger.info("[Factory] Added web search tool")

                    tools = await build_tools(tools_config, user_id=user_id, knowledge=self._knowledge)
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
                        # # Inject command_desc auth_token and list_id for knowledge_search (list chat)
                        # if tool_spec.name == "knowledge_search" and command_desc:
                        #     if "auth_token" not in params and command_desc.get(
                        #         "auth_token"
                        #     ):
                        #         params["auth_token"] = command_desc["auth_token"]
                        #     if "list_id" not in params and command_desc.get("list_id"):
                        #         params["list_id"] = command_desc["list_id"]
                        config.add(
                            tool_spec.name, provider=tool_spec.provider, **params
                        )
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
                tools = await build_tools(config, user_id=user_id, knowledge=self._knowledge)
            # Add client proxy tools from plugin manifests (round-trip: model -> device -> result)
            if client_tool_runner and config_used and config_used.entries:
                try:
                    from src.plugins.loader import load_plugins, get_manifest
                    from src.plugins.tool_gen import build_client_proxy_tools

                    load_plugins()
                    client_manifests = []
                    integration_ids: dict[str, list[dict]] = {}
                    seen_manifest_names: set[str] = set()
                    for name, tool_item in config_used.entries.items():
                        manifest = get_manifest(name)
                        if not manifest:
                            continue
                        exec_type = (manifest.get("execution") or {}).get("type")
                        if exec_type not in ("client", "hybrid"):
                            continue

                        manifest_name = manifest.get("name", "")

                        # Email now runs server-side via UnifiedEmailTools; never
                        # expose it as a device-executed client proxy tool.
                        if manifest_name.lower() in ("imap", "gmail"):
                            continue

                        # Add each manifest only once (multiple per-account entries share the same manifest)
                        if manifest_name not in seen_manifest_names:
                            seen_manifest_names.add(manifest_name)
                            client_manifests.append(manifest)

                        # Collect account info, always keyed by manifest name (not raw entry name)
                        accounts_list = tool_item.params.get("accounts")
                        if accounts_list and isinstance(accounts_list, list):
                            # New grouped format — authoritative list
                            integration_ids[manifest_name] = accounts_list
                        elif tool_item.params.get("integration_id"):
                            # Legacy single integration_id
                            existing = integration_ids.get(manifest_name, [])
                            entry = {
                                "id": tool_item.params["integration_id"],
                                "display_name": tool_item.params.get(
                                    "display_name", ""
                                ),
                            }
                            if not any(a.get("id") == entry["id"] for a in existing):
                                existing.append(entry)
                            integration_ids[manifest_name] = existing
                        elif name.lower() != manifest_name.lower():
                            # Per-account OAuth entry, e.g. "Gmail (user@example.com)"
                            # Use account_email as the stable integration ID recognised by the device
                            account_email = tool_item.params.get("account_email", "")
                            if account_email:
                                display = tool_item.params.get(
                                    "display_name", account_email
                                )
                                existing = integration_ids.get(manifest_name, [])
                                if not any(
                                    a.get("id") == account_email for a in existing
                                ):
                                    existing.append(
                                        {"id": account_email, "display_name": display}
                                    )
                                integration_ids[manifest_name] = existing
                    if client_manifests:
                        proxy_tools = build_client_proxy_tools(
                            client_manifests, client_tool_runner, integration_ids
                        )
                        tools = list(tools) + proxy_tools
                        logger.info(
                            "[Factory] Added %d client proxy tools from manifests",
                            len(proxy_tools),
                        )
                except Exception as e:
                    logger.warning("[Factory] Failed to add client proxy tools: %s", e)

        # Add user_interaction tool (ask_user) - available to all agents with client_tool_runner
        if client_tool_runner:
            try:
                from src.tools.user_interaction import UserInteractionTools

                user_interaction_tool = UserInteractionTools()
                user_interaction_tool.client_tool_runner = client_tool_runner
                tools = list(tools) + [user_interaction_tool]
                logger.info("[Factory] Added user_interaction tool (ask_user)")
            except Exception as e:
                logger.warning("[Factory] Failed to add user_interaction tool: %s", e)

        # Add planning tool (patch_plan_document) - available to all agents with client_tool_runner
        if client_tool_runner:
            try:
                from src.tools.planning import PlanningTools

                planning_tool = PlanningTools()
                planning_tool.client_tool_runner = client_tool_runner
                tools = list(tools) + [planning_tool]
                logger.info("[Factory] Added planning tool (patch_plan_document)")
            except Exception as e:
                logger.warning("[Factory] Failed to add planning tool: %s", e)

        # Add projects tool (list_projects) - available to all agents with a user_id
        if user_id:
            try:
                from src.tools.projects import ProjectsTools

                db_url = os.getenv("DB_DSN", "")
                if db_url:
                    projects_tool = ProjectsTools(db_url=db_url, user_id=user_id)
                    tools = list(tools) + [projects_tool]
                    logger.info("[Factory] Added projects tool (list_projects)")
            except Exception as e:
                logger.warning("[Factory] Failed to add projects tool: %s", e)

        # Add maps tool (open_route, search_places) - available to all agents
        try:
            from src.tools.maps import MapsTool

            maps_tool = MapsTool(user_location=user_location)
            tools = list(tools) + [maps_tool]
            logger.info("[Factory] Added MapsTool (open_route, search_places) user_location=%r", user_location)
        except Exception as e:
            logger.warning("[Factory] Failed to add MapsTool: %s", e)

        # Capture built tools BEFORE adding SchedulerTools (to avoid including it in saved tools)
        # We pass the actual Toolkit objects, not ToolSpec configs

        # Add remember_this tool — explicit RAG indexing by agent request
        if user_id and self._knowledge is not None:
            try:
                from src.tools.user_memory import UserMemoryTools

                memory_tool = UserMemoryTools(knowledge=self._knowledge, user_id=user_id)
                tools = list(tools) + [memory_tool]
                logger.info("[Factory] Added UserMemoryTools (remember_this) for user=%s", user_id)
            except Exception as e:
                logger.warning("[Factory] Failed to add UserMemoryTools: %s", e)

        # Add notification tool (schedule_notification) - available to all agents with a user_id
        if user_id:
            try:
                from src.tools.notification import NotificationTools

                notification_tool = NotificationTools(user_id=user_id)
                tools = list(tools) + [notification_tool]
                logger.info("[Factory] Added NotificationTools (schedule_notification) for user=%s", user_id)
            except Exception as e:
                logger.warning("[Factory] Failed to add NotificationTools: %s", e)

        # Add watch tool (self-reminders) - available to all agents with a user_id
        if user_id:
            try:
                from src.tools.watch import WatchTools

                watch_tool = WatchTools(user_id=user_id)
                tools = list(tools) + [watch_tool]
                logger.info("[Factory] Added WatchTools (create/list/cancel reminder) for user=%s", user_id)
            except Exception as e:
                logger.warning("[Factory] Failed to add WatchTools: %s", e)

        # Wrap sandbox access in a delegate_to sub-agent. When the user has the
        # sandbox integration enabled, Nomi delegates coding/env tasks to a Sandbox
        # Engineer instead of driving raw exec_command itself, so the noisy shell
        # loop stays out of Nomi's context. The engineer reuses the SAME SandboxTools
        # instance (same user:project VM, cached sandbox id, server-side token).
        try:
            sandbox_tool = next(
                (t for t in tools if getattr(t, "name", "") == "sandbox_tools"),
                None,
            )
            if sandbox_tool is not None:
                from src.agents.sandbox_engineer import build_sandbox_engineer_agent
                from src.tools.delegation import DelegationTools

                registry = {
                    "sandbox_engineer": (
                        lambda sb=sandbox_tool, m=model: build_sandbox_engineer_agent(
                            model=m,
                            sandbox_tools=sb,
                            db=None,
                            debug_mode=self._debug_mode,
                        )
                    )
                }
                # Drop the raw sandbox toolkit from Nomi's own tools — it now reaches
                # the sandbox only by delegating to the engineer.
                tools = [t for t in tools if t is not sandbox_tool]
                tools.append(DelegationTools(registry=registry))
                logger.info(
                    "[Factory] Wired delegate_to(sandbox_engineer) and removed raw sandbox tool"
                )
        except Exception as e:
            logger.warning("[Factory] Failed to wire delegation tool: %s", e)

        # Register chat history search tool for single chat mode
        if single_chat_mode and user_id and self._knowledge is not None:
            from src.tools.chat_history import make_search_chat_history
            search_fn = make_search_chat_history(self._knowledge, user_id)
            tools.append(search_fn)
            logger.info("[Factory] Registered search_chat_history tool for user=%s", user_id)

        # Setup RAG User ID: use user_id if explicit, or session_id if anonymous
        rag_user_id = user_id or session_id

        logger.debug("[WS] tools: %s", [t.name for t in tools])
        logger.info(
            "[WS] Building agent: session_id=%s rag_user_id=%s model=%s agent_type=%s tools_count=%d",
            session_id,
            rag_user_id,
            model_name or "default",
            agent_type or "nomi",
            len(tools),
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

            if agent_type and agent_type.lower() == "planner":
                has_web_search = any(
                    getattr(t, "name", "") == "web_search" for t in tools
                )
                if not has_web_search and (
                    not model_name or not model_name.startswith("gemma-")
                ):
                    config = ToolsConfig()
                    config.add("web_search")
                    search_tools = await build_tools(config, knowledge=self._knowledge)
                    tools = list(tools) + list(search_tools)
                    logger.info("[Factory] Added web_search tool to PlannerAgent")

                agent = build_planner_agent(
                    model=model,
                    tools=tools,
                    timezone=timezone,
                    debug_mode=self._debug_mode,
                    db=self._db,
                    session_id=session_id,
                )
                logger.info("[Factory] Built PlannerAgent for agent_type=planner")
            else:
                use_agno_sessions = (
                    storage_backend is not None and storage_backend.use_agno_sessions()
                )
                # Session summaries require the model to return structured JSON.
                # Only Claude models do this reliably; others (GLM, Gemini, etc.)
                # return empty or unstructured responses, causing parse failures.
                supports_json_summaries = bool(
                    model_name and model_name.startswith("claude-")
                )
                agent = NomiAgent(
                    db=self._db,
                    model=model,
                    tools=tools,
                    debug_mode=self._debug_mode,
                    thinking=thinking,
                    user_id=rag_user_id,
                    timezone=timezone,
                    knowledge=self._knowledge,
                    user_location=user_location,
                    identity=bot_identity,
                    session_id=session_id if use_agno_sessions else None,
                    num_history_runs=6,
                    enable_session_summaries=use_agno_sessions and supports_json_summaries,
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
                agent_type or "nomi",
                e,
                exc_info=True,
            )
            raise


def build_proactive_prompt(event_type: str, payload: dict) -> str:
    """Build a synthesized user-facing prompt from a proactive event.

    Args:
        event_type: The type of proactive event (e.g. 'calendar_upcoming', 'email_new').
        payload: The event payload dict.

    Returns:
        A prompt string to feed to the agent as if the user sent it.
    """
    if event_type == "calendar_upcoming":
        title = payload.get("title", "Untitled event")
        start_time = payload.get("start_time", "unknown time")
        end_time = payload.get("end_time", "unknown time")
        participants = payload.get("participants", [])
        participants_csv = ", ".join(participants) if participants else "none"
        location = payload.get("location") or "none"
        return (
            f"A calendar event is coming up in ~15 minutes:\n"
            f"- Title: {title}\n"
            f"- Time: {start_time} – {end_time}\n"
            f"- Participants: {participants_csv}\n"
            f"- Location: {location}\n"
            f"\n"
            f"Prepare a brief for the user:\n"
            f"1. One-paragraph context from your memory about this meeting / these participants / this topic.\n"
            f"2. 2-3 likely open questions or things to bring.\n"
            f"3. Anything from past conversations or notes that's relevant.\n"
            f"Be concise — this is a heads-up, not an essay."
        )

    if event_type == "email_new":
        sender = payload.get("sender", "unknown sender")
        subject = payload.get("subject", "(no subject)")
        snippet = payload.get("snippet", "")
        return (
            f"A new email just arrived:\n"
            f"- From: {sender}\n"
            f"- Subject: {subject}\n"
            f"- Snippet: {snippet}\n"
            f"\n"
            f"Triage for the user:\n"
            f"1. One-line summary of what this email is about and why it matters (or doesn't).\n"
            f"2. Suggested action (reply / archive / delegate / no-op).\n"
            f"3. If a reply is warranted, draft a 2-3 sentence response the user can review.\n"
            f"Keep it tight."
        )

    if event_type == "reminder_due":
        title = payload.get("title", "Untitled reminder")
        due_date = payload.get("due_date", "soon")
        notes = payload.get("notes") or ""
        list_name = payload.get("list") or ""
        return (
            f"A reminder is coming due:\n"
            f"- Title: {title}\n"
            f"- Due: {due_date}\n"
            f"- List: {list_name or 'none'}\n"
            f"- Notes: {notes or 'none'}\n"
            f"\n"
            f"Nudge the user:\n"
            f"1. One-line restatement of the task and when it's due.\n"
            f"2. Anything from memory or past conversations that helps complete it.\n"
            f"3. If useful, offer a concrete next step or to break it down.\n"
            f"Keep it short and actionable."
        )

    if event_type == "daily_brief":
        local_date = payload.get("local_date", "today")
        return (
            f"It's the start of the user's day ({local_date}). "
            f"Prepare a concise morning brief using your available tools and memory:\n"
            f"1. Today's calendar — meetings/events and any prep needed.\n"
            f"2. Important unread emails worth their attention (skip noise).\n"
            f"3. Tasks or reminders due today.\n"
            f"4. Anything relevant from past conversations or notes.\n"
            f"Lead with what matters most. Use short bullet points, not an essay. "
            f"If a section has nothing noteworthy, omit it rather than padding."
        )

    if event_type == "health_anomaly":
        metric = payload.get("metric", "a health metric")
        value = payload.get("value", "unknown")
        threshold = payload.get("threshold", "expected range")
        date = payload.get("date", "recently")
        return (
            f"A health signal looks off:\n"
            f"- Metric: {metric}\n"
            f"- Value: {value}\n"
            f"- Expected: {threshold}\n"
            f"- When: {date}\n"
            f"\n"
            f"Gently check in with the user:\n"
            f"1. Note the observation without alarm or medical claims.\n"
            f"2. Offer one practical, non-judgmental suggestion if appropriate.\n"
            f"3. Invite them to share context — don't diagnose.\n"
            f"Be warm and brief. You are not a doctor."
        )

    if event_type == "watch_reminder":
        context = payload.get("context", "something you wanted to revisit")
        return (
            f"You earlier set yourself a reminder to come back to:\n"
            f"- {context}\n"
            f"\n"
            f"Resurface it for the user:\n"
            f"1. Restate the reminder in one line.\n"
            f"2. Pull any relevant context from memory or past conversations.\n"
            f"3. Suggest a concrete next step.\n"
            f"Keep it short and actionable."
        )

    # Fallback for unknown event types
    return (
        f"A proactive event of type {event_type} occurred. "
        f"Payload: {json.dumps(payload)}. "
        f"Decide if and how to inform the user."
    )


def build_proactive_deep_link(event_type: str, payload: dict) -> str | None:
    """Compute a native deep-link URL for a proactive event, or None.

    The link launches the relevant device app (Calendar, Reminders, …) when the
    user taps "Open" on the proactive card. Returns an internal nomi:// route
    for app-owned destinations (daily brief), or None when no useful target
    exists for this event/payload.
    """
    if event_type == "calendar_upcoming":
        # iOS Calendar opens to a date via calshow:<seconds-since-2001-reference>,
        # but a plain Unix timestamp also works on modern iOS. Use start_ts if present.
        start_ts = payload.get("start_ts")
        if isinstance(start_ts, (int, float)):
            return f"calshow:{int(start_ts)}"
        return "calshow:"

    if event_type in ("reminder_due", "watch_reminder"):
        # Opens the iOS Reminders app.
        return "x-apple-reminderkit://"

    if event_type == "email_new":
        # Prefer a provider-specific deep link when we have a message id.
        message_id = payload.get("message_id") or payload.get("id")
        if message_id:
            return f"message://{message_id}"
        return "message://"

    if event_type == "daily_brief":
        # App-owned destination: the Planning tab.
        return "nomi://planning"

    if event_type == "health_anomaly":
        return "x-apple-health://"

    return None
