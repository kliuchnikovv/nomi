from __future__ import annotations

from typing import Iterator

from src.commands.base import CommandSpec


class CommandRegistry:
    _by_name: dict[str, CommandSpec] = {}

    @classmethod
    def register(cls, spec: CommandSpec) -> None:
        if spec.name in cls._by_name:
            raise ValueError(f"duplicate command name: {spec.name}")
        cls._by_name[spec.name] = spec

    @classmethod
    def get(cls, name: str) -> CommandSpec | None:
        return cls._by_name.get(name)

    @classmethod
    def all(cls) -> list[CommandSpec]:
        return sorted(cls._by_name.values(), key=lambda s: s.name)

    @classmethod
    def __iter__(cls) -> Iterator[CommandSpec]:  # convenience
        return iter(cls.all())

    @classmethod
    def _reset_for_tests(cls) -> None:
        cls._by_name = {}
