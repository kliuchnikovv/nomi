from __future__ import annotations

import json as json_lib
import logging
from typing import Any, Dict, Sequence

import httpx
from pydantic import ValidationError

from src.tools.factory import ToolsConfig
from src.tools.models import ToolsResponse, ToolSpec

logger = logging.getLogger(__name__)


class ToolConfigClient:
    """
    Client responsible for loading per-session tool configuration from an external API.
    """

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = 5.0,
        client: httpx.AsyncClient | None = None,
    ):
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._client = client or httpx.AsyncClient(timeout=timeout)

    async def fetch_tools(self, session_id: str) -> ToolsConfig:
        config = ToolsConfig()
        if not session_id:
            return config

        try:
            response = await self._client.get(
                f"{self._base_url}/api/tools",
                params={"session_id": session_id},
            )
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            logger.warning("Failed to load tools for session %s: %s", session_id, exc)
            return config

        try:
            parsed = ToolsResponse.model_validate(payload)
        except ValidationError:
            parsed = None

        if parsed is not None:
            for tool in parsed.tools:
                if not tool.enabled:
                    continue
                config.add(tool.name, **tool.params)
            return config

        raw_tools = payload.get("tools")
        if isinstance(raw_tools, dict):
            for name, params in raw_tools.items():
                config.add(name, **(params or {}))
            return config

        if isinstance(raw_tools, Sequence) and raw_tools and not isinstance(raw_tools[0], dict):
            for name in raw_tools:
                config.add(str(name))
            return config

        if isinstance(raw_tools, Sequence):
            for entry in raw_tools:
                if not isinstance(entry, dict):
                    continue
                name = entry.get("name") or entry.get("tool")
                if not name:
                    continue
                params = entry.get("params") or entry.get("options") or {}
                config.add(name, **params)
            return config

        # Fallback: treat payload as dict of tool name -> params
        for name, params in payload.items():
            if name == "tools":
                continue
            if isinstance(params, dict):
                config.add(name, **params)
        return config

    async def fetch_tools_list(self, session_id: str | None = None) -> list[ToolSpec]:
        """
        Получает список инструментов из genie-api (пока без авторизации).
        Возвращает список ToolSpec объектов.
        """
        tools: list[ToolSpec] = []
        
        try:
            # Пока без авторизации - делаем запрос без токена
            # TODO: добавить авторизацию когда будет нужно
            response = await self._client.get(
                f"{self._base_url}/api/tools",
                params={"session_id": session_id} if session_id else None,
            )
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            logger.warning("Failed to fetch tools list: %s", exc)
            return tools

        def _parse_params(params_value: Any) -> Dict[str, Any]:
            """Парсит params из JSON строки или возвращает как есть, если это dict."""
            if isinstance(params_value, dict):
                return params_value
            if isinstance(params_value, str):
                try:
                    return json_lib.loads(params_value)
                except (json_lib.JSONDecodeError, TypeError):
                    return {}
            return {}

        # API возвращает массив инструментов
        if isinstance(payload, list):
            for item in payload:
                try:
                    if not isinstance(item, dict):
                        continue
                    params = _parse_params(item.get("params"))
                    tool = ToolSpec(
                        name=item.get("name", ""),
                        enabled=item.get("enabled", True),
                        params=params,
                    )
                    tools.append(tool)
                except Exception as e:
                    logger.warning("Failed to parse tool: %s, error: %s", item, e)
                    continue
        # Или объект с полем tools
        elif isinstance(payload, dict):
            tools_list = payload.get("tools", [])
            if isinstance(tools_list, list):
                for item in tools_list:
                    try:
                        if isinstance(item, dict):
                            params = _parse_params(item.get("params"))
                            tool = ToolSpec(
                                name=item.get("name", ""),
                                enabled=item.get("enabled", True),
                                params=params,
                            )
                        else:
                            tool = ToolSpec(name=str(item))
                        tools.append(tool)
                    except Exception as e:
                        logger.warning("Failed to parse tool: %s, error: %s", item, e)
                        continue

        return tools

    async def close(self) -> None:
        await self._client.aclose()
