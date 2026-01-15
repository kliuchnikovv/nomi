import pytest
from unittest.mock import MagicMock, patch
from src.teams.development.agents import ArchitectAgent
from src.teams.development.models import AnalystOutput, AnalystDetails, FunctionalRequirement, UserScenario
from src.tools.task_manager import TaskManagementTool

def test_architect_agent_flow():
    # 1. Mock TaskManagementTool
    mock_tool = MagicMock(spec=TaskManagementTool)
    mock_tool.create_task.return_value = "Successfully created task 'Test Task' (ID: 123)"

    # 2. Create Mock PRD (AnalystOutput)
    prd = AnalystOutput(
        msg="Analysis complete",
        content=AnalystDetails(
            project_id="proj-123",
            task_id="task-456",
            summary="Add login feature",
            requirements=[
                FunctionalRequirement(
                    id="REQ-001",
                    title="Login API",
                    description="Implement POST /login",
                    priority="P0",
                    acceptance_criteria=["Returns JWT"],
                    module_context=["back", "api"]
                )
            ],
            scenarios=[
                UserScenario(
                    scenario="As a user I want to login",
                    acceptance_criteria=["Success on valid creds"]
                )
            ],
            affected_modules=["auth"],
            relevant_rag_snippets=[],
            constraints=[]
        )
    )

    # 3. Initialize Agent
    architect = ArchitectAgent(task_manager=mock_tool)

    # 4. Run Agent (Mocking the internal agent.run to avoid real LLM calls if possible,
    #    BUT we want to verify tool calls.
    #    Since we can't easily mock the LLM's decision making without a real API key or a sophisticated mock,
    #    we will mock the `agent.run` method to SIMULATE the tool call execution if we were writing a pure unit test.
    #    However, to test the *integration* of the logic we wrote, we can check if the tool wrapper works.)

    # Check if the tool wrapper is correctly defined in the agent
    # We can inspect `architect.agent.tools`

    tools = architect.agent.tools
    assert len(tools) > 0
    create_plan_tool = tools[0]

    # 5. Simulate the LLM calling the tool
    # The tool is a Pydantic/function wrapper. Let's call the underlying function.
    # Depending on Agno version, it might be wrapped differently.
    # Usually it's `tool.func` or we can just access the local function if we exposed it,
    # but it's defined inside __init__.

    # We can invoke the tool directly via the agent's tool list if Agno exposes it callable.
    # Assuming Agno tools are callables or have a `execute` method.
    # Let's inspect the first tool.

    # For this test, since we cannot rely on the LLM to actually call the tool without an API key,
    # we will extract the tool function and call it manually to verify it calls `mock_tool.create_task`.

    # In Agno, tools are often just the functions themselves or wrappers.
    tool_func = create_plan_tool.func if hasattr(create_plan_tool, 'func') else create_plan_tool

    # Call the tool function
    subtasks = [
        {"title": "Implement Login Handler", "description": "Go handler", "priority": "high"},
        {"title": "Update Frontend Auth", "description": "React context", "priority": "medium"}
    ]

    result = tool_func(project_id="proj-123", files_to_create=[], files_to_modify=[], subtasks=subtasks)

    # 6. Verify assertions
    assert "Successfully created task" in result
    assert mock_tool.create_task.call_count == 2
    mock_tool.create_task.assert_any_call("proj-123", "Implement Login Handler", "Go handler", "high")
    mock_tool.create_task.assert_any_call("proj-123", "Update Frontend Auth", "React context", "medium")

if __name__ == "__main__":
    test_architect_agent_flow()
