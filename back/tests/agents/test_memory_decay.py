# back/tests/agents/test_memory_decay.py
"""Tests for NomiAgent memory decay / staleness marking."""

import time

import pytest
from unittest.mock import MagicMock


def test_nomiagent_importable():
    from src.agents.nomi import NomiAgent
    # Verify it's the real class, not a MagicMock
    assert isinstance(NomiAgent, type), f"NomiAgent should be a real type, got {type(NomiAgent)}"
    assert NomiAgent.__module__ == "src.agents.nomi", "NomiAgent should be loaded from src.agents.nomi"


def _make_agent(user_id="user1"):
    """Build a NomiAgent instance without calling __init__."""
    from src.agents.nomi import NomiAgent
    agent = object.__new__(NomiAgent)
    agent.user_id = user_id
    agent.memory_manager = MagicMock()
    agent.memory_manager.db = MagicMock()
    return agent


def _make_memory(memory_id, text, age_days, updated_days=None):
    now = int(time.time())
    m = MagicMock()
    m.memory_id = memory_id
    m.memory = text
    m.created_at = now - age_days * 86400
    m.updated_at = (now - updated_days * 86400) if updated_days is not None else None
    m.topics = None
    return m


@pytest.mark.asyncio
async def test_old_memory_gets_stale_prefix():
    agent = _make_agent()
    mem = _make_memory("m1", "User likes Vienna", age_days=200)
    agent.memory_manager.db.get_user_memories.return_value = [mem]

    from src.agents.nomi import STALE_PREFIX
    count = await agent._mark_stale_memories()

    assert count == 1
    assert mem.memory == STALE_PREFIX + "User likes Vienna"
    agent.memory_manager.db.replace_user_memory.assert_called_once_with("m1", mem)


@pytest.mark.asyncio
async def test_fresh_memory_not_marked():
    agent = _make_agent()
    mem = _make_memory("m2", "User lives in Berlin", age_days=10)
    agent.memory_manager.db.get_user_memories.return_value = [mem]

    count = await agent._mark_stale_memories()

    assert count == 0
    agent.memory_manager.db.replace_user_memory.assert_not_called()


@pytest.mark.asyncio
async def test_recently_updated_memory_not_marked():
    """created_at old but updated_at recent → not stale."""
    agent = _make_agent()
    mem = _make_memory("m3", "User has a cat", age_days=300, updated_days=5)
    agent.memory_manager.db.get_user_memories.return_value = [mem]

    count = await agent._mark_stale_memories()

    assert count == 0
    agent.memory_manager.db.replace_user_memory.assert_not_called()


@pytest.mark.asyncio
async def test_already_stale_memory_not_double_marked():
    agent = _make_agent()
    from src.agents.nomi import STALE_PREFIX
    mem = _make_memory("m4", STALE_PREFIX + "User likes Vienna", age_days=200)
    agent.memory_manager.db.get_user_memories.return_value = [mem]

    count = await agent._mark_stale_memories()

    assert count == 0
    agent.memory_manager.db.replace_user_memory.assert_not_called()


@pytest.mark.asyncio
async def test_stale_prefix_removed_when_memory_confirmed():
    """updated_at is recent (agent called update_memory) but prefix still present → strip it."""
    agent = _make_agent()
    from src.agents.nomi import STALE_PREFIX
    mem = _make_memory("m5", STALE_PREFIX + "User likes Vienna", age_days=300, updated_days=1)
    agent.memory_manager.db.get_user_memories.return_value = [mem]

    count = await agent._mark_stale_memories()

    assert count == 1
    assert mem.memory == "User likes Vienna"
    agent.memory_manager.db.replace_user_memory.assert_called_once_with("m5", mem)


@pytest.mark.asyncio
async def test_no_user_id_skips_check():
    agent = _make_agent(user_id="")
    count = await agent._mark_stale_memories()
    assert count == 0


@pytest.mark.asyncio
async def test_no_memory_manager_skips_check():
    from src.agents.nomi import NomiAgent
    agent = object.__new__(NomiAgent)
    agent.user_id = "user1"
    agent.memory_manager = None
    count = await agent._mark_stale_memories()
    assert count == 0


@pytest.mark.asyncio
async def test_memory_with_no_timestamps_skipped():
    """Memories where both created_at and updated_at are None must not be marked stale."""
    agent = _make_agent()
    mem = _make_memory("m6", "User speaks French", age_days=0)
    mem.created_at = None
    mem.updated_at = None
    agent.memory_manager.db.get_user_memories.return_value = [mem]

    count = await agent._mark_stale_memories()

    assert count == 0
    agent.memory_manager.db.replace_user_memory.assert_not_called()
    assert mem.memory == "User speaks French"


def test_normalize_strips_stale_prefix():
    from src.agents.nomi import NomiAgent, STALE_PREFIX
    normalize = NomiAgent._normalize_memory_text
    assert normalize(STALE_PREFIX + "User likes Vienna") == normalize("User likes Vienna")
    assert normalize(STALE_PREFIX + "User likes Vienna") == "user likes vienna"


@pytest.mark.asyncio
async def test_arun_calls_mark_stale_after_run():
    from src.agents.nomi import NomiAgent
    agent = object.__new__(NomiAgent)
    agent.user_id = "user1"
    agent.memory_manager = MagicMock()
    agent.memory_manager.db = MagicMock()
    agent.memory_manager.db.get_user_memories.return_value = []

    called = []

    async def fake_dedup():
        called.append("dedup")
        return 0

    async def fake_conflicts():
        called.append("conflicts")
        return 0

    async def fake_stale():
        called.append("stale")
        return 0

    agent._deduplicate_memories = fake_dedup
    agent._resolve_memory_conflicts = fake_conflicts
    agent._mark_stale_memories = fake_stale

    async def fake_parent_arun(*args, **kwargs):
        return MagicMock()

    import unittest.mock as mock
    with mock.patch.object(
        NomiAgent.__bases__[0], "arun", new=fake_parent_arun
    ):
        await agent.arun()

    assert called == ["dedup", "conflicts", "stale"]


@pytest.mark.asyncio
async def test_arun_streaming_calls_mark_stale_in_order():
    from src.agents.nomi import NomiAgent
    agent = object.__new__(NomiAgent)
    agent.user_id = "user1"
    agent.stream = True
    agent.memory_manager = MagicMock()
    agent.memory_manager.db = MagicMock()
    agent.memory_manager.db.get_user_memories.return_value = []

    called = []

    async def fake_dedup():
        called.append("dedup")
        return 0

    async def fake_conflicts():
        called.append("conflicts")
        return 0

    async def fake_stale():
        called.append("stale")
        return 0

    agent._deduplicate_memories = fake_dedup
    agent._resolve_memory_conflicts = fake_conflicts
    agent._mark_stale_memories = fake_stale

    async def fake_parent_arun(*args, **kwargs):
        return
        yield  # make it an async generator

    import unittest.mock as mock
    with mock.patch.object(NomiAgent.__bases__[0], "arun", new=fake_parent_arun):
        gen = await agent.arun(stream=True)
        async for _ in gen:
            pass

    assert called == ["dedup", "conflicts", "stale"]
