import pytest
from pydantic import BaseModel, Field

from src.commands.base import CommandResult, command
from src.commands.registry import CommandRegistry


class _A(BaseModel):
    text: str = Field(..., min_length=1)


@pytest.fixture(autouse=True)
def _isolate():
    CommandRegistry._reset_for_tests()
    yield
    CommandRegistry._reset_for_tests()


def test_public_listing_includes_schema_and_missing():
    @command(
        name="t.one",
        title="One",
        description="desc",
        args_model=_A,
        requires=("gmail",),
    )
    async def h(args, ctx):
        return CommandResult.ok()

    listing = CommandRegistry.public_listing(missing_resolver=lambda req: list(req))
    assert len(listing) == 1
    entry = listing[0]
    assert entry["name"] == "t.one"
    assert entry["title"] == "One"
    assert entry["requires"] == ["gmail"]
    assert entry["missing"] == ["gmail"]
    assert entry["args_schema"]["properties"]["text"]["type"] == "string"


def test_router_schemas_shape():
    @command(name="t.two", title="Two", description="d2", args_model=_A)
    async def h(args, ctx):
        return CommandResult.ok()

    rs = CommandRegistry.router_schemas()
    assert len(rs) == 1
    s = rs[0]
    assert s["name"] == "t.two"
    assert s["execution"] == "command"
    assert s["accounts"] == []
    assert len(s["methods"]) == 1
    assert s["methods"][0]["name"] == "invoke"
    assert s["methods"][0]["parameters"]["properties"]["text"]["type"] == "string"
