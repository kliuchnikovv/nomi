from textwrap import dedent
from typing import Optional

from agno.agent import Agent, AgentKnowledge
from agno.db import BaseDb
from agno.models.base import Model
from agno.team import Team

from src.teams.genie.agent import GenieAgent

# --- Instructions for each role ---

analyst_instructions = dedent('''
You are an **Analyst**. Your goal is to thoroughly analyze the user's request, identify missing requirements, and clarify the scope.
1. Read the user's request carefully.
2. Identify any ambiguities or missing information.
3. Suggest necessary clarifications or refinements to the requirements.
4. Ensure the requirements are complete and atomic before passing to the Architect.
''')

architect_instructions = dedent('''
You are an **Architect**. Your goal is to design a robust and scalable technical solution based on the requirements provided by the Analyst.
1. Review the requirements from the Analyst.
2. Design the system architecture, including components, interfaces, and data flow.
3. Ensure the design aligns with best practices and the existing system structure.
4. Break down the implementation into logical steps for the Developer.
''')

developer_instructions = dedent('''
You are a **Developer**. Your goal is to write high-quality, efficient code and tests based on the Architect's design.
1. Implement the solution according to the Architect's plan.
2. Write clean, maintainable, and well-documented code.
3. Create comprehensive unit and smoke tests to verify the implementation.
4. Ensure the code handles edge cases and errors gracefully.
''')

reviewer_instructions = dedent('''
You are a **Reviewer**. Your goal is to validate the code and tests produced by the Developer.
1. Review the code for correctness, readability, and adherence to standards.
2. Verify that the tests cover the requirements and scenarios.
3. Identify any bugs, security vulnerabilities, or performance issues.
4. Provide constructive feedback or approval.
''')


class DevelopmentTeam(Team):
    def __init__(
        self,
        model: Model,
        db: BaseDb | None = None,
        markdown: bool = True,
        debug_mode: bool = False,
    ):
        description = dedent('''
        You are leading a **Development Team** consisting of an Analyst, Architect, Developer, and Reviewer.
        Your goal is to coordinate their efforts to deliver high-quality software solutions.
        
        The typical flow is:
        1. **Analyst** clarifies requirements.
        2. **Architect** designs the solution.
        3. **Developer** implements code and tests.
        4. **Reviewer** validates the result.
        ''')
        
        instructions = dedent('''
        # Development Team Instructions
        
        1. Start by having the **Analyst** evaluate the user's request.
        2. Once requirements are clear, have the **Architect** propose a technical design.
        3. Then, instruct the **Developer** to implement the solution and write tests.
        4. Finally, ask the **Reviewer** to check the implementation.
        5. Present the final result to the user.
        ''')

        super().__init__(
            model=model,
            db=db,
            description=description,
            instructions=instructions,
            members=[
                Agent(
                    name="Analyst",
                    model=model,
                    instructions=analyst_instructions,
                    markdown=markdown,
                    debug_mode=debug_mode,
                ),
                Agent(
                    name="Architect",
                    model=model,
                    instructions=architect_instructions,
                    markdown=markdown,
                    debug_mode=debug_mode,
                ),
                Agent(
                    name="Developer",
                    model=model,
                    instructions=developer_instructions,
                    markdown=markdown,
                    debug_mode=debug_mode,
                ),
                Agent(
                    name="Reviewer",
                    model=model,
                    instructions=reviewer_instructions,
                    markdown=markdown,
                    debug_mode=debug_mode,
                ),
            ],
            add_history_to_context=True,
            debug_mode=debug_mode,
        )
