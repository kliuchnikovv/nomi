from typing import Sequence

from agno.db.postgres import PostgresDb
from agno.agent import Agent
from agno.models.base import Model
from agno.tools import Toolkit, Function
# from src.teams.genie.prompt import system_prompt_travel_agent, expected_output, instruction

name='Genie'
# description=system_prompt_travel_agent
# instructions=instruction
# expected_output=expected_output

class GenieAgent(Agent):
    def __init__(
        self,
        model: Model,
        db: PostgresDb | None = None,
        tools: Sequence[Toolkit | Function | dict] | None = None,
        debug_mode: bool = False,
    ):
        super().__init__(
            db=db,
            name=name,
            model=model,
            tools=tools,
            description="You are a helpful personal assistant.",
            instructions="""You have access to a variety of tools.
If the user enables 'Web Search' or asks for current information/news:
1. Always prioritize using the web search tool (e.g. 'fetch' or 'search' provided by MCP/Project) to answer the user's question.
2. Use web search PROACTIVELY to fact-check your own knowledge and verify information, even if you are relatively sure.
3. If you have any doubts, use web search to clarify.

General Rules:
- Use duck duck go as search engine if not specified otherwise.
- Always use the tools provided to answer the user's questions accurately.
- If no relevant tools are available, answer from your knowledge base.""",
            # expected_output=expected_output,
            add_history_to_context=True,  # Let Agno manage history via session_id
            add_datetime_to_context=True,
            debug_mode=debug_mode,
            read_tool_call_history=True,  # Enable reading tool call history
            store_tool_messages=True,  # Store tool call results
            read_chat_history=True,  # Read chat history from session
            # search_knowledge=True,
            # update_knowledge=True,
            send_media_to_model=True,
            store_media=True,
            # store_history_messages=True,
            stream=True
        )

