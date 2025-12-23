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

BASE_INSTRUCTIONS = """You have access to a variety of tools.

Multi-Account Tools (Gmail, Calendar):
- If you have access to multiple tools of the same type (e.g., multiple Gmail accounts),
  each tool's instructions will specify which account it operates.
- If the user's request doesn't clearly indicate which account to use,
  ASK the user to clarify before executing the action.
- Example: "I see you have 2 Gmail accounts: work@company.com and personal@gmail.com. 
  Which account would you like me to use?"

If the user enables 'Web Search' or asks for current information/news:
1. Always prioritize using the web search tool (e.g. 'fetch' or 'search' provided by MCP/Project) to answer the user's question.
2. Use web search PROACTIVELY to fact-check your own knowledge and verify information, even if you are relatively sure.
3. If you have any doubts, use web search to clarify.

General Rules:
- Use duck duck go as search engine if not specified otherwise.
- Always use the tools provided to answer the user's questions accurately.
- If no relevant tools are available, answer from your knowledge base."""

THINKING_INSTRUCTIONS = """

THINKING MODE ENABLED:
When thinking mode is enabled, you MUST show your reasoning process:
1. **Break down the problem** - Analyze the user's request step by step
2. **Consider alternatives** - Think about different approaches before choosing
3. **Show your reasoning** - Use bullet points or numbered steps to explain your thought process
4. **Be explicit** - State your assumptions and why you made certain decisions
5. **Conclude clearly** - After reasoning, provide a clear final answer

Format your thinking as:
🤔 **Analysis:**
- [Your step-by-step reasoning here]

💡 **Conclusion:**
[Your final answer]"""

class GenieAgent(Agent):
    def __init__(
        self,
        model: Model,
        db: PostgresDb | None = None,
        tools: Sequence[Toolkit | Function | dict] | None = None,
        debug_mode: bool = False,
        thinking: bool = False,
    ):
        instructions = BASE_INSTRUCTIONS
        if thinking:
            instructions += THINKING_INSTRUCTIONS
            
        super().__init__(
            db=db,
            name=name,
            model=model,
            tools=tools,
            description="You are a helpful personal assistant.",
            instructions=instructions,
            # expected_output=expected_output,
            add_history_to_context=True,  # Agno automatically adds session history to context
            add_datetime_to_context=True,
            debug_mode=debug_mode,
            # read_tool_call_history=True,  # DISABLED: returns incomplete data (only system msg)
            store_tool_messages=True,  # Store tool call results
            # read_chat_history=True,
            # search_knowledge=True,
            # update_knowledge=True,
            send_media_to_model=True,
            store_media=True,
            # store_history_messages=True,
            stream=True
        )
