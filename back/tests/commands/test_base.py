import pytest
from pydantic import BaseModel

from src.commands.base import CommandResult, command
from src.commands.registry import CommandRegistry


def test_ok_default():
    r = CommandResult.ok()
    assert r.ok is True
    assert r.text == ""
    assert r.data is None
    assert r.error is None
    assert r.question is None


def test_ok_with_payload():
    r = CommandResult.ok(text="done", data={"id": 1})
    assert r.ok is True
    assert r.text == "done"
    assert r.data == {"id": 1}


def test_error():
    r = CommandResult.error(code="bad", message="oops")
    assert r.ok is False
    assert r.error == {"code": "bad", "message": "oops"}


def test_question():
    r = CommandResult.question(question="which?", options=["a", "b"])
    assert r.ok is False
    assert r.question == {"question": "which?", "options": ["a", "b"]}


class _Args(BaseModel):
    x: int


@pytest.fixture(autouse=True)
def _isolate_registry():
    CommandRegistry._reset_for_tests()
    yield
    CommandRegistry._reset_for_tests()


def test_command_decorator_registers():
    @command(name="t.one", title="One", description="d", args_model=_Args)
    async def handler(args, ctx):
        return CommandResult.ok()

    spec = CommandRegistry.get("t.one")
    assert spec is not None
    assert spec.title == "One"
    assert spec.args_model is _Args
    assert spec.requires == ()
    assert spec.surface == "chat"
    assert spec.handler is handler


def test_command_decorator_duplicate_raises():
    @command(name="t.dup", title="A", description="d", args_model=_Args)
    async def h1(args, ctx):
        return CommandResult.ok()

    with pytest.raises(ValueError, match="duplicate"):

        @command(name="t.dup", title="B", description="d", args_model=_Args)
        async def h2(args, ctx):
            return CommandResult.ok()


def test_registry_all_returns_sorted():
    @command(name="t.b", title="B", description="d", args_model=_Args)
    async def hb(args, ctx):
        return CommandResult.ok()

    @command(name="t.a", title="A", description="d", args_model=_Args)
    async def ha(args, ctx):
        return CommandResult.ok()

    names = [s.name for s in CommandRegistry.all()]
    assert names == ["t.a", "t.b"]
