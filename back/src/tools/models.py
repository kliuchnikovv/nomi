from __future__ import annotations

from pydantic import BaseModel, Field


class ToolSpec(BaseModel):
    """
    Strongly-typed description of a single tool configuration.
    """

    name: str
    enabled: bool = True
    params: dict[str, Any] = Field(default_factory=dict)


class ToolsResponse(BaseModel):
    """
    Expected payload structure returned by /api/tools endpoint.
    """

    tools: list[ToolSpec] = Field(default_factory=list)
