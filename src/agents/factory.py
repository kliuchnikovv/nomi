from typing import List
from agno.agent import Agent
from agno.db.postgres import PostgresDb
from agno.models.base import Model

from src.agents.genie import GenieAgent
from src.tools.config import ToolConfigClient
from src.tools.factory import build as build_tools
from agno.tools.gmail import GmailTools
from agno.tools.googlecalendar import GoogleCalendarTools
from agno.tools import Toolkit
from google.oauth2.credentials import Credentials


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

    async def build(self, session_id: str) -> Agent:
        # config = await self._config_client.fetch_tools(session_id)
        # tools = await build_tools(config)
        tools: List[Toolkit] = [GmailTools(
            creds=Credentials(
                token=None,
                refresh_token="1//049lHvWs1nUl4CgYIARAAGAQSNwF-L9IrlhRoF0I4oyko8cWyyHUA1M2ixcwD0me_vaRRtAo04uFxopWDmQro8q57XmNS5JKBEGo"
            )
        ),GoogleCalendarTools(
            access_token=""
        )]

        return GenieAgent(
            db=self._db,
            model=self._model,
            tools=tools,
            debug_mode=self._debug_mode,
        )
