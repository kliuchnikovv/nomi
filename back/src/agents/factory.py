import logging
import os

from typing import List, Optional
from agno.agent import Agent
from agno.db.postgres import PostgresDb
from agno.models.base import Model
from agno.models.google import Gemini

from src.agents.genie import GenieAgent
from src.agents.rag import RagAgent
from src.agents.memoriser import MemoriserAgent
from src.agents.mailer import MailerAgent
from src.tools.config import ToolConfigClient
from src.tools.factory import build as build_tools, ToolsConfig
from src.tools.models import ToolSpec
from agno.tools.gmail import GmailTools
from agno.tools.googlecalendar import GoogleCalendarTools
from agno.tools import Toolkit
from google.oauth2.credentials import Credentials


logger = logging.getLogger(__name__)

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


    @property
    def config_client(self) -> ToolConfigClient:
        """Доступ к ToolConfigClient для запроса инструментов."""
        return self._config_client

    def build_model(self, model_name: str, web_search: bool = False, thinking: bool = False) -> Model:
        """Build a model instance from model name.
        
        Args:
            model_name: Name of the model (e.g., 'gemini-2.0-flash', 'gemini-1.5-pro')
            web_search: If True, enable native Gemini search grounding
            thinking: If True, enable thinking mode for supported models (Gemini 2.5+)
            
        Returns:
            Model instance
            
        Raises:
            ValueError: If model name is not supported
        """
        # Support Gemini models
        if model_name.startswith("gemini-"):
            api_key = os.getenv("GOOGLE_API_KEY")
            if not api_key:
                raise ValueError("GOOGLE_API_KEY environment variable not set")
            
            # Configure thinking mode for supported models (Gemini 2.5 Pro/Flash)
            thinking_budget = None
            include_thoughts = None
            if thinking and model_name.startswith("gemini-2.5-") and "lite" not in model_name:
                # Use dynamic thinking budget (-1) for automatic adjustment
                thinking_budget = -1
                include_thoughts = True
                logger.info("[Factory] Enabling thinking mode for model: %s", model_name)
            
            return Gemini(
                id=model_name,
                api_key=api_key,
                search=web_search,
                thinking_budget=thinking_budget,
                include_thoughts=include_thoughts
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
        thinking: bool = False,
    ) -> Agent:
        # Use provided model or default
        # If command_desc has model, use it if model_name is not provided
        if not model_name and command_desc and command_desc.get("model"):
            model_name = command_desc["model"]

        model = self.build_model(model_name, web_search=web_search, thinking=thinking) if model_name else self._model
        
        tools: List[Toolkit] = []
        
        logger.debug("[WS] tools: %s", [t.name for t in tools_specs] if tools_specs else [])
        if tools_specs:
            # Строим инструменты из полученных спецификаций
            config = ToolsConfig()
            for tool_spec in tools_specs:
                if tool_spec.enabled:
                    config.add(tool_spec.name, **tool_spec.params)
                    logger.debug("[WS] tool appended: enabled")
                else:
                    logger.debug("[WS] tool not appended: not enabled")
            tools = await build_tools(config)
        
        logger.debug("[WS] tools: %s", [t.name for t in tools ])
        logger.info("[WS] Building agent: session_id=%s model=%s agent_type=%s tools_count=%d", 
                   session_id, model_name or "default", agent_type or "genie", len(tools))

        try:
            if command_desc and command_desc.get('type'):
                agent_type = command_desc['type']
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
                )
            elif agent_type and agent_type.lower() == "memoriser":
                agent = MemoriserAgent(
                    db=self._db,
                    model=model,
                    tools=tools,
                    debug_mode=self._debug_mode,
                )
            else:
                # Default to Genie
                agent = GenieAgent(
                    db=self._db,
                    model=model,
                    tools=tools,
                    debug_mode=self._debug_mode,
                    thinking=thinking,
                )

            # _attach_tool_context removed - ChatHistoryTool is disabled
            # self._attach_tool_context(agent, tools)
            logger.info("[WS] Agent created successfully: session_id=%s type=%s", session_id, agent.name)
            return agent
        except Exception as e:
            logger.error(
                "[WS] Failed to create agent: session_id=%s model=%s agent_type=%s error=%s",
                session_id,
                model_name or "default",
                agent_type or "genie",
                e,
                exc_info=True
            )
            raise
