import sys
import pytest
from unittest.mock import AsyncMock, MagicMock

from src.commands.registry import CommandRegistry
from src.commands.context import CommandContext


def _reset_and_load():
    """Reset registry and module _loaded flag, then re-import plan_build."""
    CommandRegistry._reset_for_tests()
    import src.commands as pkg
    pkg._loaded = False  # type: ignore[attr-defined]
    mod_name = "src.commands.plan_build"
    if mod_name in sys.modules:
        del sys.modules[mod_name]
    from src.commands import load_commands
    load_commands()


@pytest.fixture(autouse=True)
def _isolate():
    _reset_and_load()
    yield
    CommandRegistry._reset_for_tests()


@pytest.mark.asyncio
async def test_plan_build_invokes_workflow(monkeypatch):
    spec = CommandRegistry.get("plan.build")
    assert spec is not None

    fake_workflow = AsyncMock(return_value={"document": "PLAN!"})
    monkeypatch.setattr("src.commands.plan_build._run_workflow", fake_workflow)

    emitted = []
    ctx = CommandContext(
        user_id="u1",
        session_id="s1",
        chat_id="c1",
        tools_config=MagicMock(),
        knowledge=None,
        emit=lambda f: emitted.append(f) or AsyncMock()(),
        client_tool_runner=None,
    )

    args = spec.args_model(date="2026-06-21", freeform="meet Val at 14")
    result = await spec.handler(args, ctx)

    assert result.ok
    assert result.data["document"] == "PLAN!"
    fake_workflow.assert_awaited_once()


def test_plan_build_args_validation():
    from src.commands.plan_build import PlanBuildArgs
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        PlanBuildArgs(date="bad", freeform="x")
