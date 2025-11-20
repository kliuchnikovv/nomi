from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List
from collections.abc import Iterator

from agno.tools.gmail import GmailTools
from agno.tools.googlecalendar import GoogleCalendarTools
from agno.tools import Toolkit

ToolBuilder = Callable[[Dict[str, Any]], Toolkit]


@dataclass
class ToolItem:
    name: str
    params: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolsConfig:
    entries: Dict[str, Dict[str, Any]] = field(default_factory=dict)

    def add(self, name: str, **params: Any) -> None:
        """Register or update a tool configuration."""
        existing = self.entries.get(name, {})
        existing.update({k: v for k, v in params.items() if v is not None})
        self.entries[name] = existing

    def __iter__(self) -> Iterator[ToolItem]:
        for name, params in self.entries.items():
            yield ToolItem(name=name, params=params)

TOOL_BUILDERS: Dict[str, ToolBuilder] = {
    "gmail": lambda params: GmailTools(**params),
    "google_calendar": lambda params: GoogleCalendarTools(**params),
}


def register_tool(name: str, builder: ToolBuilder) -> None:
    """Extend factory with custom builders."""
    TOOL_BUILDERS[name] = builder


async def build(config: ToolsConfig) -> List[Toolkit]:
    tools: List[Toolkit] = []
    for item in config:
        builder = TOOL_BUILDERS.get(item.name)
        if not builder:
            continue
        tools.append(builder(item.params))
    return tools
