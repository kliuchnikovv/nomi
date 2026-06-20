from __future__ import annotations

from typing import Callable, Iterator, Sequence

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

    @classmethod
    def public_listing(
        cls, missing_resolver: Callable[[Sequence[str]], list[str]]
    ) -> list[dict]:
        """Return listing suitable for GET /commands endpoint.

        Args:
            missing_resolver: Function that takes a sequence of requires and returns
                             a list of missing integrations for this command.

        Returns:
            List of dicts with keys: name, title, description, requires, missing, args_schema, surface.
        """
        listing = []
        for spec in cls.all():
            listing.append(
                {
                    "name": spec.name,
                    "title": spec.title,
                    "description": spec.description,
                    "requires": list(spec.requires),
                    "missing": list(missing_resolver(spec.requires)),
                    "args_schema": spec.args_model.model_json_schema(),
                    "surface": spec.surface,
                }
            )
        return listing

    @classmethod
    def router_schemas(cls) -> list[dict]:
        """Return router schema format suitable for discovery integration.

        Returns:
            List of dicts shaped like discovery router schemas:
            {name, display_name, description, methods, accounts, execution}.
        """
        out = []
        for spec in cls.all():
            out.append(
                {
                    "name": spec.name,
                    "display_name": spec.title,
                    "description": spec.description,
                    "methods": [
                        {
                            "name": "invoke",
                            "description": spec.description,
                            "parameters": spec.args_model.model_json_schema(),
                        }
                    ],
                    "accounts": [],
                    "execution": "command",
                }
            )
        return out
