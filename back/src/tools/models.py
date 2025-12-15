from __future__ import annotations

from typing import Any, Dict, List

from pydantic import BaseModel, Field


class ToolSpec(BaseModel):
    """
    Strongly-typed description of a single tool configuration.
    """

    name: str
    enabled: bool = True
    params: Dict[str, Any] = Field(default_factory=dict)


class ToolsResponse(BaseModel):
    """
    Expected payload structure returned by the /api/tools endpoint.
    """

    tools: List[ToolSpec] = Field(default_factory=list)
