from typing import Optional, List, Any
from agno.team import Team
from agno.models.base import Model
from agno.db.postgres import PostgresDb
from agno.tools import Toolkit, Function
import logging

logger = logging.getLogger(__name__)


class TeamFactory:
    def __init__(self, agent_factory: Any, db: PostgresDb | None, model: Model, debug_mode: bool = False):
        self.agent_factory = agent_factory
        self.db = db
        self.model = model
        self.debug_mode = debug_mode

    async def build(self, command_desc: dict, session_id: str) -> Team:
        logger.info("[WS] Building Team from command description: %s", command_desc)
        
        team_type = command_desc.get("type", "").lower()
        
        # 1. Check for Predefined Teams
        if team_type == "travel_planning":
             from src.teams.travel_planning.team import TravelPlanning
             logger.info("[WS] Instantiating TravelPlanning team")
             # Assuming keys are in environment or config - for now passing what we have or empty
             # In a real scenario we'd pull these from environment vars or TeamFactory init
             import os
             return TravelPlanning(
                 model=self.model,
                 maps_key=os.getenv("GOOGLE_MAPS_API_KEY", ""),
                 exa_key=os.getenv("EXA_API_KEY", ""),
                 db=self.db,
                 debug_mode=self.debug_mode
             )
        
        elif team_type == "genie":
            from src.teams.genie.team import GenieTeam
            logger.info("[WS] Instantiating GenieTeam")
            import os
            return GenieTeam(
                model=self.model,
                maps_key=os.getenv("GOOGLE_MAPS_API_KEY", ""),
                db=self.db,
                debug_mode=self.debug_mode
            )

        elif team_type == "development_team":
            from src.teams.development.team import DevelopmentTeam
            logger.info("[WS] Instantiating DevelopmentTeam")
            return DevelopmentTeam(
                model=self.model,
                db=self.db,
                debug_mode=self.debug_mode
            )

        elif team_type == "dnd_team":
            from src.teams.dnd.team import DnDTeam
            from src.teams.dnd.tools import DnDTools

            logger.info("[WS] Instantiating DnDTeam")
            team = DnDTeam(
                model=self.model,
                db=self.db,
                debug_mode=self.debug_mode,
            )

            # Inject tools with session_id
            dnd_tools = DnDTools(room_id=session_id)
            team.tools.append(dnd_tools)
            team.secretary.tools.append(dnd_tools)
            team.dm.tools.append(dnd_tools)
            team.rules.tools.append(dnd_tools)
            # Party agent might need it too if it checks state
            team.party.tools.append(dnd_tools)

            return team

        # 2. Dynamic Team Building (Fallback)
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
        
        tools: List[Toolkit | Function | dict] = []
        team = Team(
            name=command_desc.get("name", "DynamicTeam"),
            model=team_model,
            members=members,
            tools=tools,
            db=self.db,
            add_history_to_context=True,  # Required for Agno to use messages parameter
            num_history_runs=5,
            add_team_history_to_members=True,
            num_team_history_runs=5,
            debug_mode=self.debug_mode,
        )
        try:
            team.session_id = session_id  # type: ignore[attr-defined]
        except Exception:
            pass
        return team
