"""
Реестр интеграций для Python backend.

Определяет маппинг провайдеров на builders и метаданные о типах инструментов.
"""
from typing import Dict, Callable, Optional
from enum import Enum
from agno.tools import Toolkit

from src.tools.factory import ToolBuilder


class StorageType(str, Enum):
    """Тип хранения данных интеграции."""
    CLIENT_ONLY = "client"  # Данные только на клиенте (SQLite)
    SERVER = "server"  # Данные на сервере (PostgreSQL)
    HYBRID = "hybrid"  # Гибридное хранение


class ToolType(str, Enum):
    """Тип инструмента."""
    SERVER_SIDE = "server"  # Выполняется на сервере (Python)
    CLIENT_SIDE = "client"  # Выполняется на клиенте (React Native)


class ProviderDefinition:
    """Определение провайдера интеграции."""

    def __init__(
        self,
        name: str,
        display_name: str,
        storage_type: StorageType,
        tool_type: ToolType,
        builder: Optional[ToolBuilder] = None,
        description: str = "",
    ):
        self.name = name
        self.display_name = display_name
        self.storage_type = storage_type
        self.tool_type = tool_type
        self.builder = builder
        self.description = description


# Реестр провайдеров
REGISTRY: Dict[str, ProviderDefinition] = {
    "gmail": ProviderDefinition(
        name="gmail",
        display_name="Gmail",
        storage_type=StorageType.CLIENT_ONLY,
        tool_type=ToolType.CLIENT_SIDE,
        description="Gmail интеграция - выполняется на клиенте",
    ),
    "calendar": ProviderDefinition(
        name="calendar",
        display_name="Google Calendar",
        storage_type=StorageType.CLIENT_ONLY,
        tool_type=ToolType.CLIENT_SIDE,
        description="Google Calendar интеграция - выполняется на клиенте",
    ),
    "github": ProviderDefinition(
        name="github",
        display_name="GitHub",
        storage_type=StorageType.SERVER,
        tool_type=ToolType.SERVER_SIDE,
        description="GitHub интеграция - выполняется на сервере",
    ),
    "jules": ProviderDefinition(
        name="jules",
        display_name="Jules",
        storage_type=StorageType.SERVER,
        tool_type=ToolType.SERVER_SIDE,
        description="Jules API интеграция - выполняется на сервере",
    ),
}


def get_provider(name: str) -> Optional[ProviderDefinition]:
    """Получить определение провайдера по имени."""
    return REGISTRY.get(name.lower())


def get_server_side_providers() -> Dict[str, ProviderDefinition]:
    """Получить все серверные провайдеры."""
    return {
        name: provider
        for name, provider in REGISTRY.items()
        if provider.tool_type == ToolType.SERVER_SIDE
    }


def get_client_side_providers() -> Dict[str, ProviderDefinition]:
    """Получить все клиентские провайдеры."""
    return {
        name: provider
        for name, provider in REGISTRY.items()
        if provider.tool_type == ToolType.CLIENT_SIDE
    }


def is_server_side(provider_name: str) -> bool:
    """Проверить, является ли провайдер серверным."""
    provider = get_provider(provider_name)
    if not provider:
        return False
    return provider.tool_type == ToolType.SERVER_SIDE


def is_client_side(provider_name: str) -> bool:
    """Проверить, является ли провайдер клиентским."""
    provider = get_provider(provider_name)
    if not provider:
        return False
    return provider.tool_type == ToolType.CLIENT_SIDE


def should_include_in_tools(provider_name: str) -> bool:
    """
    Проверить, нужно ли включать провайдер в список tools для Python backend.
    
    Только серверные провайдеры должны быть включены в список tools,
    так как клиентские выполняются локально на устройстве.
    """
    return is_server_side(provider_name)
