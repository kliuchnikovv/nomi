"""
Tools for Travel Planning team
"""

from typing import List
from agno.tools import Toolkit

from ...tools.factory import ToolFactory


class TravelPlanningTools(Toolkit):
    """Tools for the Travel Planning team"""

    def __init__(self):
        super().__init__(name="travel_planning_tools")

        # Add team-specific tools here
        # Example: self.register(self.some_tool)

    def get_tools(self) -> List[Toolkit]:
        """Get all tools for this team"""
        return [self]
