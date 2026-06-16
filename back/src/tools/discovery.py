from __future__ import annotations

import inspect
import json
import logging
from typing import Any, Callable

from agno.tools import Function, Toolkit

from src.tools.config import ToolConfigClient
from src.tools.executor import ServerToolExecutor
from src.tools.registry import ToolRegistry
from src.tools.router import ToolRouter

logger = logging.getLogger(__name__)

# Human-readable capability labels for the in-process "local" toolkits that are
# routed through discovery_tool (maps, reminders, etc.). Keyed by Toolkit.name.
# Used both to advertise the capability in the tool description and as the
# router schema display_name. Unknown toolkit names fall back to the raw name.
LOCAL_TOOL_LABELS: dict[str, str] = {
    "maps": "maps & routes",
    "watch": "reminders & follow-ups",
    "notification": "notifications",
    "planning": "day planning",
    "projects": "projects",
    "user_memory": "saving notes to memory",
}


def _github_token_from_config(tools_config: Any) -> str | None:
    """Find the user's GitHub access token across the whole tools config.

    The token lives on the ``github`` entry (single-account ``access_token`` or
    multi-account ``credentials[id].access_token``), not on the sandbox entry.
    Defined locally to avoid importing factory (which imports this module).
    """
    entry = tools_config.entries.get("github") if tools_config else None
    if entry is None:
        return None
    params = entry.params or {}
    token = params.get("access_token")
    if isinstance(token, str) and token:
        return token
    creds = params.get("credentials")
    if isinstance(creds, dict):
        for account_creds in creds.values():
            if isinstance(account_creds, dict):
                at = account_creds.get("access_token")
                if isinstance(at, str) and at:
                    return at
    return None


def _build_discovery_description(local_tools: list[Toolkit] | None = None) -> str:
    """Build the discovery_tool description from loaded plugin manifests.

    The capability list is generated dynamically (never hardcoded) so newly
    added integrations — e.g. Apple Health — are advertised to the agent
    automatically. Without this, the agent only knows about whatever was
    hardcoded and silently skips routing requests for unlisted capabilities.

    ``local_tools`` are the in-process toolkits (maps, reminders, etc.) that are
    consolidated behind discovery_tool; their capabilities are advertised too so
    the agent routes those requests here instead of looking for a direct tool.
    """
    capabilities: list[str] = ["web search"]
    from src.plugins.loader import load_plugins, get_manifests

    try:
        load_plugins()
    except Exception:
        # load_plugins() populates manifests before registering delivery
        # handlers; a late-stage failure there must not blank the list.
        logger.warning("[Discovery] load_plugins raised; using manifests loaded so far", exc_info=True)
    try:
        for manifest in get_manifests():
            tools_cfg = manifest.get("tools") or {}
            if tools_cfg.get("include", True) is False:
                continue
            label = manifest.get("display_name") or manifest.get("name")
            if label and label not in capabilities:
                capabilities.append(label)
    except Exception:
        logger.warning("[Discovery] Failed to build capability list", exc_info=True)

    for tk in local_tools or []:
        label = LOCAL_TOOL_LABELS.get(tk.name, tk.name)
        if label and label not in capabilities:
            capabilities.append(label)

    return (
        "Execute any available action by describing what you need in natural "
        "language. Available capabilities include: " + ", ".join(capabilities) + ". "
        "Use this for anything involving the user's connected services or device "
        "data (email, calendar, reminders, contacts, health & fitness, code, web, "
        "etc.) instead of answering from memory. "
        "Returns a result, a clarifying question, or an error."
    )


def _account_display(tool_schema: dict, account_id: str) -> str:
    """Human-readable account label for a resolved account_id (UUID → email/name)."""
    if not account_id or account_id == "*":
        return ""
    for account in tool_schema.get("accounts", []):
        if account.get("id") == account_id:
            return account.get("display_name") or account_id
    return ""


def _inject_integration_id(
    tool_schema: dict, method_name: str, params: dict, account_id: str
) -> dict:
    """Supply `integration_id` for client methods that need it.

    Client IMAP methods identify the account by `integration_id`. The device can
    resolve EITHER value: a UUID (matched directly against its local credential
    store, kept in sync with the server id via reconciliation) OR an email
    address (resolved by natural key provider+email in IMAPEmailClient). We send
    the account's display_name (email) when available because it survives any
    residual UUID divergence between server and device; otherwise we fall back to
    the account UUID.
    """
    if not account_id or account_id == "*":
        return params
    method = next(
        (m for m in tool_schema.get("methods", []) if m.get("name") == method_name),
        None,
    )
    props = ((method or {}).get("parameters") or {}).get("properties") or {}
    if "integration_id" in props and not params.get("integration_id"):
        # Prefer display_name (email) so device can resolve by email when its
        # local UUID differs from the server-side account_id.
        account = next(
            (a for a in tool_schema.get("accounts", []) if a.get("id") == account_id),
            None,
        )
        integration_id_value = (account.get("display_name") if account else None) or account_id
        return {**params, "integration_id": integration_id_value}
    return params


async def _execute_for_all_accounts(
    decision,
    tool_schema,
    tools_config,
    executor,
    client_tool_runner,
) -> str:
    """Execute operation for all accounts of a tool and aggregate results."""
    accounts = tool_schema.get("accounts", [])
    if not accounts:
        return json.dumps({"type": "error", "error": "No accounts found"})

    results = []

    for account in accounts:
        account_id = account.get("id", "")
        if not account_id:
            continue

        try:
            if (
                tool_schema.get("execution") in ("client", "hybrid")
                and client_tool_runner
            ):
                client_params = _inject_integration_id(
                    tool_schema, decision.method, decision.params, account_id
                )
                client_result = await client_tool_runner(
                    decision.tool, decision.method, client_params
                )
                results.append(
                    {
                        "account_id": account_id,
                        "account_display": account.get("display_name", account_id),
                        "result": client_result,
                    }
                )
            else:
                entry = tools_config.entries.get(decision.tool)
                if not entry:
                    continue

                creds_map = (
                    entry.params.get("credentials")
                    if isinstance(entry.params.get("credentials"), dict)
                    else {}
                )
                credentials = creds_map.get(account_id) or {}

                server_result = await executor.arun(
                    decision.tool, decision.method, decision.params, credentials
                )
                results.append(
                    {
                        "account_id": account_id,
                        "account_display": account.get("display_name", account_id),
                        "result": server_result,
                    }
                )
        except Exception as e:
            logger.warning(
                "[Discovery] Failed to execute for account=%s: %s",
                account_id,
                e,
                exc_info=True,
            )
            results.append(
                {
                    "account_id": account_id,
                    "account_display": account.get("display_name", account_id),
                    "error": str(e),
                }
            )

    if not results:
        return json.dumps(
            {"type": "error", "error": "Failed to execute for any account"}
        )

    return json.dumps(
        {
            "type": "result",
            "result": results,
            "aggregated": True,
            "account_count": len(results),
            "tool": decision.tool,
            "method": decision.method,
        }
    )


def _toolkit_functions(tk: Toolkit) -> dict[str, Function]:
    """All registered Functions of a toolkit (Agno splits sync vs async)."""
    return {**tk.functions, **tk.async_functions}


def _local_schemas(local_tools: list[Toolkit]) -> list[dict[str, Any]]:
    """Build router schemas for in-process toolkits routed via discovery_tool.

    These toolkits have no plugin manifest, credentials, or accounts — they are
    executed directly against the pre-built instance. We expose each method's
    name/description/parameters so the router can pick one, marking the schema
    ``execution: "local"`` and giving it no accounts.
    """
    schemas: list[dict[str, Any]] = []
    for tk in local_tools:
        methods: list[dict[str, Any]] = []
        for fn in _toolkit_functions(tk).values():
            # Agno populates Function.parameters lazily from the entrypoint
            # signature/docstring; force it so the router sees the arg schema.
            try:
                fn.process_entrypoint()
            except Exception:
                logger.debug("[Discovery] process_entrypoint failed for %s", fn.name, exc_info=True)
            methods.append(
                {
                    "name": fn.name,
                    "description": fn.description or "",
                    "parameters": fn.parameters or {"type": "object", "properties": {}},
                }
            )
        schemas.append(
            {
                "name": tk.name,
                "display_name": LOCAL_TOOL_LABELS.get(tk.name, tk.name),
                "description": "",
                "methods": methods,
                "accounts": [],
                "execution": "local",
            }
        )
    return schemas


async def _execute_local(tk: Toolkit, decision) -> str:
    """Execute a routed method directly on an in-process toolkit instance."""
    fn = _toolkit_functions(tk).get(decision.method)
    if fn is None or not callable(getattr(fn, "entrypoint", None)):
        return json.dumps(
            {
                "type": "error",
                "error": f"Unknown method: {decision.method}",
                "tool": decision.tool,
                "method": decision.method,
            }
        )
    try:
        result = fn.entrypoint(**decision.params)
        if inspect.iscoroutine(result):
            result = await result
        return json.dumps(
            {
                "type": "result",
                "result": str(result) if result is not None else "",
                "tool": decision.tool,
                "method": decision.method,
                "account": "",
            }
        )
    except Exception:
        logger.warning(
            "[Discovery] Local tool error: tool=%s method=%s",
            decision.tool,
            decision.method,
            exc_info=True,
        )
        return json.dumps(
            {
                "type": "error",
                "error": "Tool execution failed",
                "tool": decision.tool,
                "method": decision.method,
            }
        )


def build_discovery_tool(
    user_id: str,
    config_client: ToolConfigClient,
    client_tool_runner: Callable | None = None,
    *,
    local_tools: list[Toolkit] | None = None,
    router: ToolRouter | None = None,
    executor: ServerToolExecutor | None = None,
) -> Function:
    """
    Build the discovery_tool Agno Function for a given user session.
    Pass router/executor only in tests to inject mocks.
    """
    _router = router or ToolRouter()
    _executor = executor or ServerToolExecutor()
    _local_tools = local_tools or []
    _local_index = {tk.name: tk for tk in _local_tools}
    _local_schema_list = _local_schemas(_local_tools)

    async def _discovery_tool(request: str, context: str = "") -> str:
        """
        Execute any available action by describing it in natural language.

        Use this tool whenever you need to interact with external services
        (email, calendar, GitHub, web search, etc.). Describe what you want
        to do in plain language. If the tool needs clarification (e.g., which
        account to use), it will return a question — pass it to the user and
        call this tool again with the answer in `context`.

        Multi-account support: When account_id="*" is returned by the router,
        the tool executes the operation for all accounts and returns aggregated results.

        Args:
            request: Natural language description of the action to perform.
            context: Optional additional context (e.g. "use work@gmail.com").

        Returns:
            JSON string: {"type": "result", "result": "..."}
                      or {"type": "question", "question": "...", "options": [...]}
                      or {"type": "error", "error": "..."}
            For multi-account execution: {"type": "result", "result": [...], "aggregated": True, "account_count": N}
        """
        try:
            tools_config = await config_client.fetch_tools(user_id=user_id)
        except Exception:
            logger.warning(
                "[Discovery] Failed to fetch tools for user=%s", user_id, exc_info=True
            )
            return json.dumps({"type": "error", "error": "Failed to load integrations"})

        # Local (in-process) toolkits are always routable; integrations come from
        # the user's config. Combine both so the router can pick either.
        schemas = ToolRegistry.build(tools_config) + _local_schema_list
        if not schemas:
            return json.dumps({"type": "error", "error": "No integrations connected"})

        try:
            decision = _router.decide(request, context, schemas)
        except Exception:
            logger.warning(
                "[Discovery] Router failed for user=%s", user_id, exc_info=True
            )
            return json.dumps({"type": "error", "error": "Failed to route request"})

        # Deterministic safeguard: if the user explicitly asked for ALL accounts but
        # the (LLM) router still asked which one, fan out instead of pestering them.
        if decision.action == "question" and decision.tool and decision.method:
            text = f"{request} {context}".lower()
            all_accounts_kw = (
                "all account",
                "all my account",
                "all of my account",
                "every account",
                "each account",
                "across all",
                "both account",
                "все аккаунт",
                "всех аккаунт",
                "по всем аккаунт",
                "каждом аккаунт",
                "во всех",
            )
            schema = next(
                (s for s in schemas if s["name"] == decision.tool), None
            )
            if (
                schema
                and len(schema.get("accounts", [])) >= 2
                and any(kw in text for kw in all_accounts_kw)
            ):
                logger.info(
                    "[Discovery] Overriding question → all-accounts for: %s", request
                )
                decision.action = "execute"
                decision.account_id = "*"

        if decision.action == "question":
            # Return the clarifying question to chat. (We previously popped a
            # native ask_user modal from here, but the nested client round-trip's
            # answer was never delivered back to the waiting call_id — it timed
            # out and stacked duplicate modals, hanging the chat. The LLM relays
            # this question to the user and calls discovery_tool again with the
            # answer in `context`.)
            return json.dumps(
                {
                    "type": "question",
                    "question": decision.question,
                    "options": decision.options,
                }
            )

        if decision.action == "none":
            # Fallback: don't dead-end on requests the router couldn't map to a
            # specific tool. If web search is available, answer general/current-
            # info questions (weather, news, facts) with it instead of returning
            # an error the agent treats as "I can't do that".
            web_tk = _local_index.get("web_search")
            if web_tk is not None:
                logger.info(
                    "[Discovery] No specific tool matched; falling back to "
                    "web_search for: %s",
                    request,
                )
                query = f"{request} {context}".strip() if context else request
                decision.tool = "web_search"
                decision.method = "duckduckgo_search"
                decision.params = {"query": query}
                return await _execute_local(web_tk, decision)
            return json.dumps(
                {"type": "error", "error": f"No tool found for: {request}"}
            )

        # Local toolkit path: dispatch directly to the in-process instance. These
        # have no manifest/credentials/accounts, so they bypass the registry and
        # ServerToolExecutor entirely.
        local_tk = _local_index.get(decision.tool)
        if local_tk is not None:
            return await _execute_local(local_tk, decision)

        tool_schema = next((s for s in schemas if s["name"] == decision.tool), None)
        if not tool_schema:
            return json.dumps(
                {"type": "error", "error": f"Unknown tool: {decision.tool}"}
            )

        if decision.account_id == "*":
            return await _execute_for_all_accounts(
                decision,
                tool_schema,
                tools_config,
                _executor,
                client_tool_runner,
            )

        # Client-execution path (iOS-native: Calendar, Reminders) and hybrid tools (Gmail, etc.)
        if tool_schema.get("execution") in ("client", "hybrid"):
            if tool_schema.get("execution") == "client" and not client_tool_runner:
                return json.dumps(
                    {
                        "type": "error",
                        "error": "Client tool runner not configured",
                        "tool": decision.tool,
                        "method": decision.method,
                        "account": _account_display(tool_schema, decision.account_id),
                    }
                )
            if client_tool_runner:
                try:
                    client_params = _inject_integration_id(
                        tool_schema,
                        decision.method,
                        decision.params,
                        decision.account_id,
                    )
                    result = await client_tool_runner(
                        decision.tool, decision.method, client_params
                    )
                    return json.dumps(
                        {
                            "type": "result",
                            "result": result,
                            "tool": decision.tool,
                            "method": decision.method,
                            "account": _account_display(
                                tool_schema, decision.account_id
                            ),
                        }
                    )
                except Exception:
                    logger.warning(
                        "[Discovery] Client tool error: tool=%s method=%s",
                        decision.tool,
                        decision.method,
                        exc_info=True,
                    )
                    return json.dumps(
                        {
                            "type": "error",
                            "error": "Client tool execution failed",
                            "tool": decision.tool,
                            "method": decision.method,
                            "account": _account_display(
                                tool_schema, decision.account_id
                            ),
                        }
                    )
            # hybrid with no runner: fall through to server execution below

        # Server-execution path
        entry = tools_config.entries.get(decision.tool)
        credentials: dict[str, Any] = {}
        if entry:
            if decision.account_id:
                creds_map = (
                    entry.params.get("credentials")
                    if isinstance(entry.params.get("credentials"), dict)
                    else {}
                )
                credentials = creds_map.get(decision.account_id) or entry.params
                logger.debug(
                    "[Discovery] Using credentials for account_id=%s, found=%s",
                    decision.account_id,
                    bool(creds_map.get(decision.account_id)),
                )
            else:
                # No account_id - use first credentials from map or entry.params
                creds_map = (
                    entry.params.get("credentials")
                    if isinstance(entry.params.get("credentials"), dict)
                    else {}
                )
                if creds_map:
                    # Get first credential (single account case)
                    first_cred = next(iter(creds_map.values()), {})
                    credentials = first_cred if first_cred else entry.params
                    logger.debug(
                        "[Discovery] No account_id, using first credentials from map"
                    )
                else:
                    credentials = entry.params
                    logger.debug(
                        "[Discovery] No account_id, using entry.params directly"
                    )

            logger.debug("[Discovery] entry.params keys: %s", list(entry.params.keys()))
            logger.debug(
                "[Discovery] credentials keys: %s",
                list(credentials.keys())
                if isinstance(credentials, dict)
                else "not a dict",
            )
            logger.debug(
                "[Discovery] Has access_token: %s",
                bool(credentials.get("access_token") or credentials.get("token")),
            )

            # Check if we have valid credentials for server execution.
            # Tools with auth_type="none" don't need OAuth tokens (e.g. sandbox).
            auth_type = tool_schema.get("auth_type", "oauth") if tool_schema else "oauth"
            if auth_type != "none":
                has_access_token = bool(
                    credentials.get("access_token") or credentials.get("token")
                )
                if not has_access_token:
                    logger.warning(
                        "[Discovery] No access_token found in credentials for tool=%s",
                        decision.tool,
                    )
                    return json.dumps(
                        {
                            "type": "error",
                            "error": f"Missing credentials for {decision.tool}. Please re-connect your account.",
                            "tool": decision.tool,
                            "method": decision.method,
                            "account": _account_display(tool_schema, decision.account_id),
                        }
                    )

        # The sandbox clones private repos but its own config entry has no
        # GitHub token (auth_type="none"). The token lives on the github tool
        # entry, so thread it through here — mirrors what factory.build() does
        # via _extract_github_token() on the direct (non-discovery) path.
        # Without this, clone_repo falls back to an unauthenticated clone and
        # fails with "could not read Username for 'https://github.com'".
        if decision.tool == "sandbox" and isinstance(credentials, dict):
            gh_token = _github_token_from_config(tools_config)
            if gh_token and not credentials.get("github_token"):
                credentials = {**credentials, "github_token": gh_token}
                logger.info("[Discovery] Injected GitHub token into sandbox build")

        try:
            result = await _executor.arun(
                decision.tool, decision.method, decision.params, credentials
            )
            return json.dumps(
                {
                    "type": "result",
                    "result": result,
                    "tool": decision.tool,
                    "method": decision.method,
                    "account": _account_display(tool_schema, decision.account_id),
                }
            )
        except Exception:
            logger.warning(
                "[Discovery] Server tool error: tool=%s method=%s",
                decision.tool,
                decision.method,
                exc_info=True,
            )
            return json.dumps(
                {
                    "type": "error",
                    "error": "Tool execution failed",
                    "tool": decision.tool,
                    "method": decision.method,
                    "account": _account_display(tool_schema, decision.account_id),
                }
            )

    return Function(
        name="discovery_tool",
        description=_build_discovery_description(_local_tools),
        parameters={
            "type": "object",
            "properties": {
                "request": {
                    "type": "string",
                    "description": "Natural language description of what to do",
                },
                "context": {
                    "type": "string",
                    "description": "Additional context, e.g. which account to use",
                },
            },
            "required": ["request"],
        },
        entrypoint=_discovery_tool,
    )
