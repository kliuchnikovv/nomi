from typing import Optional, List, Any
from agno.team import Team
from agno.models.base import Model
from agno.db.postgres import PostgresDb
from agno.tools import Toolkit, Function
import logging

logger = logging.getLogger(__name__)

# from src.tools.chat_history import ChatHistoryTool  # Disabled: history is now passed directly

class TeamFactory:
    def __init__(self, agent_factory: Any, db: PostgresDb | None, model: Model, debug_mode: bool = False):
        self.agent_factory = agent_factory
        self.db = db
        self.model = model
        self.debug_mode = debug_mode

    # _attach_tool_context removed - ChatHistoryTool is disabled

    async def build(self, command_desc: dict, session_id: str) -> Team:
        logger.info("[WS] Building Team from command description")
        members = []
        if command_desc.get("participants"):
            for p_data in command_desc["participants"]:
                p_type = p_data.get("type")
                p_model = p_data.get("model")
                # Recursively build member agent using the passed agent_factory
                member = await self.agent_factory.build(
                    session_id=session_id,
                    model_name=p_model,
                    agent_type=p_type,
                    command_desc=p_data
                )
                members.append(member)
        
        # Create a generic Team
        team_model_name = command_desc.get("model")
        # Note: agent_factory.build_model is needed, or we duplicate logic. 
        # Better to expose build_model in agent_factory or pass it.
        team_model = self.agent_factory.build_model(team_model_name) if team_model_name else self.model
        
        # ChatHistoryTool disabled - history is now passed directly to the model
        tools: List[Toolkit | Function | dict] = []
        team = Team(
            name=command_desc.get("name", "DynamicTeam"),
            model=team_model,
            members=members,
            tools=tools,
            db=self.db,
            add_history_to_context=True,
            num_history_runs=5,
            add_team_history_to_members=True,
            num_team_history_runs=5,
            debug_mode=self.debug_mode,
        )
        # _attach_tool_context removed - ChatHistoryTool is disabled
        # self._attach_tool_context(team, tools)
        try:
            team.session_id = session_id  # type: ignore[attr-defined]
        except Exception:
            pass
        return team
