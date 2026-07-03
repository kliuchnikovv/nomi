"""DelegationTools honors a configurable (or disabled) wall-clock timeout."""

import asyncio

import pytest

from src.tools.delegation import DelegationTools


class _SlowAgent:
    def __init__(self, delay: float):
        self._delay = delay

    async def arun(self, task: str):
        await asyncio.sleep(self._delay)

        class _R:
            content = "done"

        return _R()


@pytest.mark.asyncio
async def test_short_timeout_trips():
    tools = DelegationTools(
        registry={"slow": lambda: _SlowAgent(1.0)}, timeout=0.01
    )
    out = await tools.delegate_to("slow", "do it")
    assert "time limit" in out.lower()


@pytest.mark.asyncio
async def test_timeout_none_does_not_trip():
    # timeout=None disables the cap entirely: a quick run must complete.
    tools = DelegationTools(
        registry={"slow": lambda: _SlowAgent(0.02)}, timeout=None
    )
    out = await tools.delegate_to("slow", "do it")
    assert out == "done"


@pytest.mark.asyncio
async def test_bounded_task_timeout_allows_quick_run():
    # Task mode now passes a large but BOUNDED timeout (TASK_DELEGATION_TIMEOUT_S)
    # instead of None: a quick run still completes well within the cap.
    tools = DelegationTools(
        registry={"slow": lambda: _SlowAgent(0.02)}, timeout=1800
    )
    out = await tools.delegate_to("slow", "do it")
    assert out == "done"
