from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ToolSpec(BaseModel):
    """
    Strongly-typed description of a single tool configuration.
    """

    name: str
    provider: str | None = None
    enabled: bool = True
    params: dict[str, Any] = Field(default_factory=dict)


class ToolsResponse(BaseModel):
    """
    Expected payload structure returned by /api/tools endpoint.
    """

    tools: list[ToolSpec] = Field(default_factory=list)


# Rebuild models to resolve forward references
ToolSpec.model_rebuild()
ToolsResponse.model_rebuild()
