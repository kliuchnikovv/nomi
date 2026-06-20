from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Sequence

from pydantic import BaseModel

from src.commands.context import CommandContext


def _make_ok(text: str = "", data: dict[str, Any] | None = None) -> "CommandResult":
    """Construct a successful CommandResult."""
    return CommandResult(ok=True, text=text, data=data)


def _make_error(code: str, message: str) -> "CommandResult":
    return CommandResult(ok=False, error={"code": code, "message": message})


def _make_question(question: str, options: list[str] | None = None) -> "CommandResult":
    return CommandResult(ok=False, question={"question": question, "options": options or []})


@dataclass
class CommandResult:
    ok: bool
    text: str = ""
    data: dict[str, Any] | None = None
    error: dict[str, str] | None = None
    question: dict[str, Any] | None = None


# Attach named constructors as classmethods after class definition to avoid
# naming collisions with the dataclass fields `ok`, `error`, and `question`.
# Tests use CommandResult.ok(), CommandResult.error(), CommandResult.question()
# as constructor calls, and result.ok / result.error / result.question as field
# reads — these two usages coexist because the constructors are plain module-
# level functions assigned as class attributes, not descriptors.
CommandResult.ok = staticmethod(_make_ok)  # type: ignore[method-assign]
CommandResult.error = staticmethod(_make_error)  # type: ignore[method-assign]
CommandResult.question = staticmethod(_make_question)  # type: ignore[method-assign]


CommandHandler = Callable[[BaseModel, CommandContext], Awaitable[CommandResult]]


@dataclass(frozen=True)
class CommandSpec:
    name: str
    title: str
    description: str
    args_model: type[BaseModel]
    handler: CommandHandler
    requires: tuple[str, ...] = field(default_factory=tuple)
    surface: str = "chat"  # "chat" | "background" | "both"


def command(
    *,
    name: str,
    title: str,
    description: str,
    args_model: type[BaseModel],
    requires: Sequence[str] = (),
    surface: str = "chat",
) -> Callable[[CommandHandler], CommandHandler]:
    """Register a command. The decorator returns the handler unchanged."""

    def _decorate(handler: CommandHandler) -> CommandHandler:
        from src.commands.registry import CommandRegistry  # avoid import cycle

        spec = CommandSpec(
            name=name,
            title=title,
            description=description,
            args_model=args_model,
            handler=handler,
            requires=tuple(requires),
            surface=surface,
        )
        CommandRegistry.register(spec)
        return handler

    return _decorate
