"""Tests for PlanningTools.patch_plan_document."""
import pytest
from unittest.mock import AsyncMock

from src.tools.planning import PlanningTools


def make_toolkit(runner=None) -> PlanningTools:
    toolkit = PlanningTools()
    toolkit.client_tool_runner = runner
    return toolkit


# ---------------------------------------------------------------------------
# No runner
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_patch_plan_document_no_runner_returns_error():
    toolkit = make_toolkit(runner=None)
    result = await toolkit.patch_plan_document(patches=[], summary="test")
    assert "Error" in result


# ---------------------------------------------------------------------------
# Successful invocations
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_patch_plan_document_calls_runner_with_correct_tool():
    runner = AsyncMock(return_value="ok")
    toolkit = make_toolkit(runner=runner)
    patches = [{"op": "add_item", "text": "Buy milk"}]
    await toolkit.patch_plan_document(patches=patches, summary="added item")
    runner.assert_awaited_once()
    call_args = runner.call_args
    assert call_args[0][0] == "patch_plan_document"


@pytest.mark.asyncio
async def test_patch_plan_document_passes_patches_in_params():
    runner = AsyncMock(return_value="ok")
    toolkit = make_toolkit(runner=runner)
    patches = [{"op": "add_chip", "item_id": "abc", "chip": {"type": "time", "value": "09:00", "id": "c1"}}]
    await toolkit.patch_plan_document(patches=patches, summary="added time chip")
    params = runner.call_args[0][2]
    assert params["patches"] == patches
    assert params["summary"] == "added time chip"


@pytest.mark.asyncio
async def test_patch_plan_document_returns_count_on_success():
    runner = AsyncMock(return_value="ok")
    toolkit = make_toolkit(runner=runner)
    patches = [
        {"op": "add_chip", "item_id": "a1", "chip": {"type": "time", "value": "09:00", "id": "c1"}},
        {"op": "add_chip", "item_id": "a2", "chip": {"type": "location", "value": "gym", "id": "c2"}},
    ]
    result = await toolkit.patch_plan_document(patches=patches, summary="two chips")
    assert "2" in result


@pytest.mark.asyncio
async def test_patch_plan_document_empty_patches():
    runner = AsyncMock(return_value="ok")
    toolkit = make_toolkit(runner=runner)
    result = await toolkit.patch_plan_document(patches=[], summary="nothing")
    runner.assert_awaited_once()
    assert "0" in result


# ---------------------------------------------------------------------------
# Runner error handling
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_patch_plan_document_runner_raises_returns_error_string():
    runner = AsyncMock(side_effect=RuntimeError("network error"))
    toolkit = make_toolkit(runner=runner)
    result = await toolkit.patch_plan_document(
        patches=[{"op": "update_item", "item_id": "x", "changes": {"text": "new"}}],
        summary="update",
    )
    assert "Error" in result
    assert "network error" in result


@pytest.mark.asyncio
async def test_patch_plan_document_summary_passed_correctly():
    runner = AsyncMock(return_value="ok")
    toolkit = make_toolkit(runner=runner)
    summary = "Planned breakfast at 9:00"
    await toolkit.patch_plan_document(patches=[], summary=summary)
    params = runner.call_args[0][2]
    assert params["summary"] == summary
