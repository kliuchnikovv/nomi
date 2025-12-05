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

# from src.tools.chat_history import ChatHistoryTool  # Disabled: history is now passed directly

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

    # _attach_tool_context removed - ChatHistoryTool is disabled

    @property
    def config_client(self) -> ToolConfigClient:
        """Доступ к ToolConfigClient для запроса инструментов."""
        return self._config_client

    def build_model(self, model_name: str) -> Model:
        """Build a model instance from model name.
        
        Args:
            model_name: Name of the model (e.g., 'gemini-2.0-flash', 'gemini-1.5-pro')
            
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
            return Gemini(id=model_name, api_key=api_key)
        
        # Add support for other providers as needed
        raise ValueError(f"Unsupported model: {model_name}")

    async def build(
        self,
        session_id: str,
        tools_specs: Optional[List[ToolSpec]] = None,
        model_name: Optional[str] = None,
        agent_type: Optional[str] = None,
        command_desc: Optional[dict] = None,
    ) -> Agent:
        # Use provided model or default
        # If command_desc has model, use it if model_name is not provided
        if not model_name and command_desc and command_desc.get("model"):
            model_name = command_desc["model"]

        model = self.build_model(model_name) if model_name else self._model
        
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
        # else:
        #     # Fallback к старым инструментам если не получили спецификации
        #     tools = [GmailTools(
        #         creds=Credentials(
        #             token=None,
        #             refresh_token="1//049lHvWs1nUl4CgYIARAAGAQSNwF-L9IrlhRoF0I4oyko8cWyyHUA1M2ixcwD0me_vaRRtAo04uFxopWDmQro8q57XmNS5JKBEGo"
        #         )
        #     ), GoogleCalendarTools(
        #         access_token=""
        #     )]

        # ChatHistoryTool disabled - history is now passed directly to the model
        # tools.append(ChatHistoryTool())
        # logger.info("[WS] ChatHistoryTool added to agent tools")
        
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
