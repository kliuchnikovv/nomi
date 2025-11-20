from typing import List

from fastapi import APIRouter


class Tool:
    ...

def router() -> APIRouter:
    r = APIRouter()

    @r.post("/tools")
    async def add_tool(tool: Tool):
        ...

    @r.get("/tools")
    async def list_tools() -> List[Tool]:
        ...

    @r.get("/tools/{tool_id}")
    async def get_tool(tool_id: int):
        ...

    @r.post("/tools/{tool_id}")
    async def disable_tool(tool_id: int):
        ...

    return r
