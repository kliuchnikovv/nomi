from typing import Sequence, Optional

from agno.db.postgres import PostgresDb
from agno.agent import Agent
from agno.knowledge import Knowledge
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

Web Search (IMPORTANT):
When you have access to web search tool, you MUST use it for:
1. **Current events and news** - Any question about recent happenings, breaking news, latest updates
2. **Real-time data** - Weather, stock prices, exchange rates, sports scores, schedules
3. **Time-sensitive information** - Events, deadlines, release dates, availability
4. **Verification** - When you're unsure about facts or need to confirm your knowledge
5. **User explicitly asks** - When user says "search", "look up", "find out", "what's the latest"

DO NOT rely on your training data for any time-sensitive questions. ALWAYS search first.
After searching, cite your sources with URLs when providing information.

Knowledge Base (IMPORTANT):
When you have access to a knowledge base, you can search it for:
1. **User preferences and facts** - Things the user has told you in the past
2. **Personal context** - Information about the user's habits, likes, dislikes
3. **Stored information** - Documents, notes, or data previously saved
4. **Historical context** - Past conversations or decisions

Use knowledge search when you need to recall information about the user or their preferences.
After retrieving knowledge, cite the source to help the user understand where the information came from.

General Rules:
- Always use the tools provided to answer the user's questions accurately.
- If no relevant tools are available, answer from your knowledge base but note that information may be outdated.
- Be proactive about using tools - it's better to search and confirm than to guess."""

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
        thinking: str = "off",
        knowledge: Optional[Knowledge] = None,
    ):
        instructions = BASE_INSTRUCTIONS
        # if thinking and thinking != "off":
        #     instructions += THINKING_INSTRUCTIONS
            
        super().__init__(
            db=db,
            name=name,
            model=model,
            tools=tools,
            knowledge=knowledge,
            search_knowledge=(knowledge is not None),  # Enable agentic search if knowledge provided
            update_knowledge=(knowledge is not None),  # Enable automatic fact storage
            description="You are a helpful personal assistant.",
            instructions=instructions,
            # expected_output=expected_output,
            add_history_to_context=True,  # Agno automatically adds session history to context
            add_datetime_to_context=True,
            debug_mode=debug_mode,
            # read_tool_call_history=True,  # DISABLED: returns incomplete data (only system msg)
            store_tool_messages=True,  # Store tool call results
            # read_chat_history=True,
            send_media_to_model=True,
            store_media=True,
            # store_history_messages=True,
            stream=True,
            stream_intermediate_steps=True,
            reasoning=(thinking != "off"),
        )

