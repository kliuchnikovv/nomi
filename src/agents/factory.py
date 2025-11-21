import logging

from typing import List, Optional
from agno.agent import Agent
from agno.db.postgres import PostgresDb
from agno.models.base import Model

from src.agents.genie import GenieAgent
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

    async def build(self, session_id: str, tools_specs: Optional[List[ToolSpec]] = None) -> Agent:
        tools: List[Toolkit] = []
        
        logger.debug("[WS] tools: %s", [t.name for t in tools_specs ])
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

        logger.debug("[WS] tools: %s", [t.name for t in tools ])

        return GenieAgent(
            db=self._db,
            model=self._model,
            tools=tools,
            debug_mode=self._debug_mode,
        )
