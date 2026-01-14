"""
Tools for Genie team
"""

from typing import List
from agno.tools import Toolkit

from ...tools.factory import ToolFactory


class GenieTools(Toolkit):
    """Tools for the Genie team"""

    def __init__(self):
        super().__init__(name="genie_tools")

        # Add team-specific tools here
        # Example: self.register(self.some_tool)

    def get_tools(self) -> List[Toolkit]:
        """Get all tools for this team"""
        return [self]
