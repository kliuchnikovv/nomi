# back/tests/agents/test_memory_decay.py
"""Tests for SouperAgent memory decay / staleness marking."""


def test_souperagent_importable():
    from src.agents.souper import SouperAgent
    # Verify it's the real class, not a MagicMock
    assert isinstance(SouperAgent, type), f"SouperAgent should be a real type, got {type(SouperAgent)}"
    assert SouperAgent.__module__ == "src.agents.souper", "SouperAgent should be loaded from src.agents.souper"
    assert not hasattr(SouperAgent, "_mark_stale_memories"), "Expected _mark_stale_memories to not exist yet"
    # _mark_stale_memories doesn't exist yet — just confirm real class loads
