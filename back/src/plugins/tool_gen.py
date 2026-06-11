"""
Generate tool definitions for the LLM from plugin manifests.
Manifest methods -> tool definitions; client plugins use generic proxy (send_and_wait).
"""

import logging
from typing import Any, Callable, Awaitable

from agno.tools import Function

logger = logging.getLogger(__name__)


def _build_parameters_schema(
    params: list[dict[str, Any]] | dict[str, Any] | None,
) -> dict[str, Any] | None:
    """
    Build JSON Schema for tool parameters from manifest params.
    Supports two formats:
    1. List of param definitions: [{"name": "x", "type": "string", ...}]
    2. Ready JSON Schema: {"type": "object", "properties": {...}, "required": [...]}

    Returns None if params are empty or have no properties.
    Excludes 'required' field if there are no required parameters (to fix Gemini API validation).
    """
    if params is None:
        return None

    # If params is already a JSON Schema (has "type" and "properties")
    if isinstance(params, dict) and "type" in params and "properties" in params:
        # Check if properties dict is empty
        properties = params.get("properties", {})
        if not properties or (isinstance(properties, dict) and len(properties) == 0):
            # Return None - this ensures Function gets no parameters field
            return None

        # Build schema - only include 'required' if it exists and all fields are valid
        required = params.get("required", [])
        if required:
            # Validate that all required fields exist in properties
            required = [r for r in required if r in properties]

        schema = {"type": params["type"], "properties": properties}
        if required:  # Only add 'required' if non-empty after validation
            schema["required"] = required
        return schema

    # Otherwise, build JSON Schema from list of param definitions
    if not isinstance(params, list):
        logger.warning("Unexpected params type: %s", type(params))
        return None

    properties = {}
    required = []
    for p in params:
        name = p.get("name")
        if not name:
            continue
        prop = {
            "type": p.get("type", "string"),
            "description": p.get("description", ""),
        }
        if "default" in p:
            prop["default"] = p["default"]
        properties[name] = prop
        if p.get("required", True):
            required.append(name)

    if not properties:
        return None

    # Build schema - exclude 'required' if empty (Gemini API validation fix)
    schema = {"type": "object", "properties": properties}
    if required and len(required) > 0:
        schema["required"] = required

    return schema


def _build_account_id_param(accounts: list[dict[str, Any]]) -> dict[str, Any] | None:
    """
    Build a JSON Schema property for account_id selection when multiple accounts exist.
    Returns None if fewer than 2 accounts (no selection needed).
    """
    if len(accounts) < 2:
        return None

    account_ids = [a.get("id") for a in accounts if a.get("id")]
    if not account_ids:
        return None

    # Build human-readable description of available accounts
    labels = []
    for a in accounts:
        aid = a.get("id", "")
        display = a.get("display_name", "")
        labels.append(f"{aid} ({display})" if display else aid)

    prop: dict[str, Any] = {
        "type": "string",
        "description": (
            "The account to use for this operation. "
            "Available accounts: " + ", ".join(labels) + ". "
            "Use 'all' to check all accounts (default when the user hasn't specified one). "
            "Only specify a particular account when the user explicitly asks for it."
        ),
        "enum": ["all"] + account_ids,
    }
    return prop


def build_client_proxy_tools(
    manifests: list[dict[str, Any]],
    client_runner: Callable[[str, str, dict[str, Any]], Awaitable[str]],
    integration_ids: dict[str, list[dict[str, Any]]] | None = None,
) -> list[Function]:
    """
    Build Function tools for client-only plugins from manifests.
    Each method becomes a tool; when called, runner(plugin, method, params) is awaited.

    Args:
        manifests: List of plugin manifests
        client_runner: Function to execute client-side tools
        integration_ids: Dict mapping provider name to list of account dicts
                         [{"id": "uuid", "display_name": "alice@gmail.com"}, ...]
    """
    tools: list[Function] = []
    integration_ids = integration_ids or {}

    for manifest in manifests:
        name = manifest.get("name") or ""
        execution = manifest.get("execution") or {}
        if execution.get("type") not in ("client", "hybrid"):
            continue

        accounts = integration_ids.get(name) or []
        methods = manifest.get("methods") or []

        for m in methods:
            method_name = m.get("name")
            if not method_name:
                continue

            tool_name = f"{name}_{method_name}"

            description = (
                m.get("description")
                or f"Call {name}.{method_name} on the user's device"
            )

            # Build base params schema from manifest
            params_schema = _build_parameters_schema(m.get("parameters"))

            # Strip integration_id — the proxy injects it automatically from the
            # registered accounts list; exposing it confuses the model.
            if params_schema and "properties" in params_schema:
                params_schema["properties"].pop("integration_id", None)
                required = params_schema.get("required", [])
                if "integration_id" in required:
                    params_schema["required"] = [r for r in required if r != "integration_id"]
                    if not params_schema["required"]:
                        params_schema.pop("required", None)

            # Inject account_id parameter when multiple accounts are available
            account_id_prop = _build_account_id_param(accounts)
            if account_id_prop is not None:
                if params_schema is None:
                    params_schema = {"type": "object", "properties": {}}
                params_schema["properties"]["account_id"] = account_id_prop
                # account_id is NEVER required — model defaults to "all"

            def _make_proxy(
                plugin: str,
                method: str,
                runner: Any,
                accs: list[dict[str, Any]],
            ):
                account_ids = [a.get("id") for a in accs if a.get("id")]
                account_labels = {
                    a.get("id"): a.get("display_name") or a.get("id")
                    for a in accs if a.get("id")
                }

                async def _call_one(target_id: str | None, kw: dict[str, Any]) -> str:
                    if target_id:
                        kw["integration_id"] = target_id
                    logger.info(
                        "[ClientProxyTool] Calling %s.%s integration=%s params=%s",
                        plugin, method, target_id, kw,
                    )
                    result = await runner(plugin, method, kw)
                    if result is None:
                        logger.warning("[ClientProxyTool] %s.%s returned None!", plugin, method)
                        return "Error: Tool execution returned None"
                    logger.info(
                        "[ClientProxyTool] %s.%s returned: %s",
                        plugin, method, result[:100] if result else result,
                    )
                    return result

                async def _proxy(**kwargs: Any) -> str:
                    account_id = kwargs.pop("account_id", None)

                    # Determine targets
                    if not account_ids:
                        # No accounts registered — call without integration_id
                        targets = [None]
                    elif not account_id or account_id == "all":
                        # Default: query all accounts
                        targets = account_ids
                    else:
                        targets = [account_id]

                    if len(targets) == 1:
                        try:
                            return await _call_one(targets[0], dict(kwargs))
                        except Exception as e:
                            logger.error(
                                "[ClientProxyTool] %s.%s failed: %s", plugin, method, str(e),
                                exc_info=True,
                            )
                            return f"Error executing tool: {str(e)}"

                    # Multiple targets — call each and combine
                    parts: list[str] = []
                    for target_id in targets:
                        label = account_labels.get(target_id, target_id)
                        try:
                            result = await _call_one(target_id, dict(kwargs))
                            parts.append(f"[{label}]\n{result}")
                        except Exception as e:
                            logger.error(
                                "[ClientProxyTool] %s.%s (%s) failed: %s",
                                plugin, method, target_id, str(e), exc_info=True,
                            )
                            parts.append(f"[{label}]\nError: {str(e)}")
                    return "\n\n---\n\n".join(parts)

                return _proxy

            fn = _make_proxy(name, method_name, client_runner, accounts)
            try:
                tool_kwargs: dict[str, Any] = {
                    "name": tool_name,
                    "description": description,
                    "entrypoint": fn,
                    # The proxy entrypoint is ``_proxy(**kwargs)``. Without this
                    # flag, Agno's process_entrypoint() re-derives the schema from
                    # that signature and overwrites our explicit ``required`` with
                    # ``["kwargs"]`` (the VAR_KEYWORD param) — which z.ai rejects
                    # with "Tool type cannot be empty" (1214). Skip processing so
                    # our manifest-built ``parameters`` is used verbatim.
                    "skip_entrypoint_processing": True,
                    "parameters": params_schema or {"type": "object", "properties": {}},
                }

                tool = Function(**tool_kwargs)
                tools.append(tool)
                logger.info("Added client proxy tool: %s", tool_name)
            except Exception as e:
                logger.warning("Failed to create proxy tool %s: %s", tool_name, e)
    return tools
