import asyncio
import json
import logging
import os
import uuid
import time
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

import redis.asyncio as redis
from agno.media import Image
from src.agents.factory import AgentFactory
from src.agents.souper import SouperAgent
from src.constants import Redis as RedisConstants
from src.server.models import Frame, Op, Kind
from src.server.utils import make_meta, make_error, make_done, make_data
from src.tools.models import ToolSpec

logger = logging.getLogger(__name__)


class RedisSession:
    def __init__(
        self,
        agent_factory: AgentFactory,
        session_id: str,
        user_id: str | None = None,
        chat_id: str | None = None,
        redis_worker: Any = None,
    ):
        self.agent_factory = agent_factory
        self.session_id = session_id
        self.user_id = user_id
        self.chat_id = chat_id or session_id
        self.redis_worker = redis_worker

        self.redis_client = None
        self.agent: Any | None = None
        self.tools_specs: list[ToolSpec] = []
        self.active_agents: set[str] = set()

        # State (similar to WS session)
        self.current_model_name: str | None = None
        self.current_thinking: str = "off"
        self.command_desc: dict | None = None
        self.agent_type: str | None = None

        # Initialize Redis for sending responses
        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        self.redis_client = redis.from_url(redis_url, decode_responses=True)
        self.next_id = 0
        self.cancel_event = asyncio.Event()

        # History storage
        self.chat_history: list[dict[str, str]] = []

        # Plugin delivery context (set from payload in handle_user_message)
        self._delivery_source: str | None = None
        self._delivery_context: dict[str, Any] = {}

        # Per-session client tool result handling
        self.pubsub: Any | None = None
        self.pending_client_tool_results: dict[str, asyncio.Future] = {}
        self._result_listener_task: asyncio.Task | None = None

    async def _start_result_listener(self):
        """Start listening for client tool results on per-session channel."""
        if self.pubsub is not None:
            return  # Already started

        try:
            # Create a new pubsub for this session
            self.pubsub = self.redis_client.pubsub()

            # Subscribe to per-session channel
            channel = RedisConstants.CHANNEL_CLIENT_TOOL_RESULT.format(self.session_id)
            await self.pubsub.subscribe(channel)

            logger.info(
                "[RedisSession] Subscribed to client tool result channel: %s", channel
            )

            # Wait for subscription confirmation to avoid race condition
            timeout = 2.0
            start_time = asyncio.get_event_loop().time()
            subscription_ready = False

            async for message in self.pubsub.listen():
                if message["type"] == "subscribe":
                    logger.info("[RedisSession] Subscription confirmed for %s", channel)
                    subscription_ready = True
                    break

                if asyncio.get_event_loop().time() - start_time > timeout:
                    logger.warning(
                        "[RedisSession] Subscription timeout, proceeding anyway"
                    )
                    subscription_ready = True
                    break

            if subscription_ready:
                # Start background listener task
                self._result_listener_task = asyncio.create_task(
                    self._listen_for_results()
                )
                logger.info(
                    "[RedisSession] Result listener started for session %s",
                    self.session_id,
                )
            else:
                logger.warning(
                    "[RedisSession] Failed to confirm subscription for %s", channel
                )

        except Exception as e:
            logger.error(
                "[RedisSession] Failed to start result listener: %s", e, exc_info=True
            )

    async def _listen_for_results(self):
        """Background task to listen for client tool results."""
        if not self.pubsub:
            return

        try:
            async for message in self.pubsub.listen():
                if message["type"] != "message":
                    continue

                try:
                    data = message.get("data")
                    if isinstance(data, bytes):
                        data = data.decode("utf-8")

                    payload = json.loads(data) if isinstance(data, str) else data
                    call_id = payload.get("call_id")
                    result = payload.get("result", "")

                    if call_id and call_id in self.pending_client_tool_results:
                        future = self.pending_client_tool_results.pop(call_id)
                        if not future.done():
                            future.set_result(result)
                            logger.info(
                                "[RedisSession] Resolved client tool result for call_id=%s",
                                call_id,
                            )
                except Exception as e:
                    logger.warning(
                        "[RedisSession] Failed to process client tool result: %s", e
                    )

        except asyncio.CancelledError:
            logger.info("[RedisSession] Result listener cancelled")
            raise
        except Exception as e:
            logger.error("[RedisSession] Result listener error: %s", e, exc_info=True)

    async def _cleanup_result_listener(self):
        """Clean up the result listener and pubsub connection."""
        if self._result_listener_task:
            self._result_listener_task.cancel()
            try:
                await self._result_listener_task
            except asyncio.CancelledError:
                pass
            self._result_listener_task = None

        if self.pubsub:
            try:
                await self.pubsub.unsubscribe()
                await self.pubsub.close()
            except Exception as e:
                logger.warning("[RedisSession] Failed to close pubsub: %s", e)
            self.pubsub = None

    async def _broadcast_system_status(self):
        count = len(self.active_agents)
        # Construct payload
        payload = {
            "type": "system_status",
            "active_agents_count": count,
            "active_agents_list": list(self.active_agents),
        }

        frame = Frame(
            id=self.next_id,
            ts=datetime.now(timezone.utc),
            kind=Kind.SIGNAL,
            op=Op.SIGNAL,
            chat_id=self.chat_id,
            payload=payload,
        )

        await self._send_frame(frame)

    async def _send_frame(self, frame: Frame) -> int:
        data = frame.marshal()
        # Target ID: User ID if known, else Session ID (fallback)
        target_id = self.user_id or self.session_id
        channel = f"chat:user:{target_id}"
        payload_json = json.dumps(data)

        if self.redis_client:
            try:
                await self.redis_client.publish(channel, payload_json)
                # Log payload size in bytes (len=15 was misleading: number of frame keys).
                # Use DEBUG for streaming MESSAGE to avoid hundreds of lines per response.
                if frame.op == Op.MESSAGE:
                    logger.debug(
                        "[RedisSession] PUBLISH %s -> %s (bytes=%d)",
                        channel,
                        frame.op,
                        len(payload_json),
                    )
                else:
                    logger.info(
                        "[RedisSession] PUBLISH %s -> %s (bytes=%d)",
                        channel,
                        frame.op,
                        len(payload_json),
                    )
            except Exception as e:
                logger.error(
                    "[RedisSession] Publish failed: %s",
                    e,
                    exc_info=True,
                    extra={
                        "channel": channel,
                        "frame_op": frame.op,
                        "chat_id": self.chat_id,
                        "user_id": self.user_id,
                        "trace_id": getattr(frame, "trace_id", None),
                    },
                )
                # Try to send error frame through alternative channel if this is not already an error frame
                if frame.kind != Kind.ERROR:
                    try:
                        error_frame = make_error(
                            self.next_id,
                            "publish_failed",
                            self.chat_id,
                            f"Failed to publish frame to Redis: {str(e)}",
                            http=500,
                            details={
                                "original_op": frame.op,
                                "channel": channel,
                                "error_type": type(e).__name__,
                            },
                        )
                        # Try direct Redis publish as last resort
                        if self.redis_client:
                            alt_channel = f"chat:user:{self.user_id or self.session_id}"
                            await self.redis_client.publish(
                                alt_channel, json.dumps(error_frame.marshal())
                            )
                    except Exception:
                        pass  # If we can't send error about error, at least we logged it

        self.next_id = frame.id + 1
        return self.next_id

    async def _send_client_action_and_wait(
        self, plugin: str, method: str, params: dict[str, Any]
    ) -> str:
        """Send client_action to the device and wait for tool result with exponential backoff retry."""
        start_time = time.time()

        logger.info(
            "[ClientTool] Sending: plugin=%s method=%s params=%s",
            plugin,
            method,
            params,
        )

        # Ensure result listener is started
        if not self.pubsub:
            await self._start_result_listener()

        call_id = str(uuid.uuid4())
        loop = asyncio.get_event_loop()
        future = loop.create_future()
        self.pending_client_tool_results[call_id] = future

        logger.info("[ClientTool] Registered call_id=%s", call_id)

        try:
            # Store idempotency key in Redis (expires in 60s)
            idempotency_key = f"client_action:{call_id}"
            idempotency_data = {
                "plugin": plugin,
                "method": method,
                "params": params,
                "sent_at": datetime.now(timezone.utc).isoformat(),
                "session_id": self.session_id,
            }
            if self.redis_client:
                await self.redis_client.setex(
                    idempotency_key, 60, json.dumps(idempotency_data)
                )

            # Send client_action frame
            payload_data = {
                "type": "client_action",
                "call_id": call_id,
                "tool": plugin,
                "method": method,
                "params": params,
            }
            await self._send_frame(
                make_data(self.next_id, Op.MESSAGE, self.chat_id, payload_data)
            )

            logger.info("[ClientTool] Sent client_action for call_id=%s", call_id)

            # Exponential backoff retry
            MAX_RETRIES = 3
            BASE_TIMEOUT = 30.0  # seconds

            for attempt in range(MAX_RETRIES):
                timeout = BASE_TIMEOUT * (1.5**attempt)  # 30s, 45s, 67.5s
                try:
                    logger.info(
                        "[ClientTool] Waiting for result (attempt %d/%d, timeout=%.1fs, call_id=%s)",
                        attempt + 1,
                        MAX_RETRIES,
                        timeout,
                        call_id,
                    )
                    result = await asyncio.wait_for(future, timeout=timeout)

                    if result is None:
                        logger.warning(
                            "[ClientTool] Result is None for call_id=%s", call_id
                        )
                        return "Error: Client returned no result (None)."

                    # Calculate latency
                    latency_ms = int((time.time() - start_time) * 1000)

                    logger.info(
                        "[ClientTool] Result received: call_id=%s latency=%dms",
                        call_id,
                        latency_ms,
                    )

                    # Delete idempotency key on success
                    if self.redis_client:
                        await self.redis_client.delete(idempotency_key)

                    return str(result)

                except asyncio.TimeoutError:
                    if attempt < MAX_RETRIES - 1:
                        logger.warning(
                            "[ClientTool] Timeout attempt %d/%d for %s.%s (call_id=%s), retrying...",
                            attempt + 1,
                            MAX_RETRIES,
                            plugin,
                            method,
                            call_id,
                        )
                        continue
                    else:
                        total_time = time.time() - start_time
                        logger.error(
                            "[ClientTool] Timeout: call_id=%s after %.1fs (%d attempts)",
                            call_id,
                            total_time,
                            MAX_RETRIES,
                        )
                        return (
                            "Client tool execution timed out (device may be offline)."
                        )

            # Fallback if we somehow exit the loop without returning
            return "Client tool execution failed (unexpected loop exit)."

        except Exception as e:
            logger.error(
                "[ClientTool] Error: plugin=%s method=%s call_id=%s error=%s",
                plugin,
                method,
                call_id,
                e,
                exc_info=True,
            )
            return f"Error executing client tool: {str(e)}"
        finally:
            self.pending_client_tool_results.pop(call_id, None)

    async def handle_frame(self, frame: Frame):
        """Process an incoming frame."""
        try:
            if frame.op == Op.MESSAGE:
                await self.handle_user_message(frame)
            elif frame.op == Op.STOP:
                # STOP is handled by RedisWorker via task.cancel()
                # This path shouldn't be reached for STOP since Worker handles it directly
                self.cancel_event.set()
                logger.info("[RedisSession] STOP received, setting cancel flag")
            else:
                logger.warning("[RedisSession] Unsupported op: %s", frame.op)
        except asyncio.CancelledError:
            logger.info("[RedisSession] Task cancelled, cleaning up")
            # Proactively repair dangling tool calls to prevent corrupted history on next run
            if self.agent:
                try:
                    await self._repair_dangling_tool_calls(self.agent)
                except Exception as e:
                    logger.error(
                        "[RedisSession] Failed to repair dangling tools during cancellation: %s",
                        e,
                    )
            raise  # Re-raise to let RedisWorker handle it
        finally:
            # Clean up resources
            await self._cleanup_result_listener()
            if self.redis_client:
                await self.redis_client.close()

    async def build_agent_instance(self, payload: dict):
        """Build the agent based on payload parameters."""
        # Extract params from payload or defaults
        self.current_model_name = payload.get("model")
        endpoint = payload.get("endpoint")
        self.streaming = bool(payload.get("streaming", False))

        thinking = payload.get("thinking")
        if thinking is not None:
            if isinstance(thinking, bool):
                self.current_thinking = "medium" if thinking else "off"
            elif isinstance(thinking, str):
                self.current_thinking = thinking.lower()

        # Tools: We don't have the TOOLS frame handshake here.
        # We rely on AgentFactory fetching tools from API using user_id.
        # IF tools are passed in payload (rare), we could parse them.

        self.agent_type = payload.get("agent_type", "genie")
        self.command_desc = payload.get("command") or payload.get("team")
        if self.command_desc is None:
            self.command_desc = {}
        elif not isinstance(self.command_desc, dict):
            try:
                self.command_desc = (
                    json.loads(self.command_desc)
                    if isinstance(self.command_desc, str)
                    else {}
                )
            except (json.JSONDecodeError, TypeError):
                self.command_desc = {}
        if isinstance(self.command_desc, dict):
            self.command_desc["streaming"] = self.streaming

        rag_user_id = self.user_id or self.session_id

        try:
            # Check if this is a Team mode request
            # agent_type could be "team" (generic) and command_desc provides specific type
            team_type = None

            if self.command_desc and isinstance(self.command_desc, dict):
                # Inject auth token if available in payload but not in command_desc
                if "auth_token" not in self.command_desc:
                    token = (
                        payload.get("auth_token")
                        or payload.get("token")
                        or payload.get("access_token")
                    )
                    if token:
                        self.command_desc["auth_token"] = token
                        logger.info(
                            "[RedisSession] Injected auth_token into command_desc"
                        )

                team_type = self.command_desc.get("type", "").lower()
                # Known team types that require TeamFactory
                known_teams = [
                    "development_team",
                    "dnd_team",
                    "travel_planning",
                    "genie",
                ]
                if team_type in known_teams:
                    logger.info("[RedisSession] Detected team mode: type=%s", team_type)
            elif self.agent_type and self.agent_type.lower() == "team":
                logger.info("[RedisSession] Detected team mode from agent_type")

            # Using regular agent factory
            client_tool_runner = (
                self._send_client_action_and_wait if self.redis_worker else None
            )
            self.agent = await self.agent_factory.build(
                session_id=self.session_id,
                tools_specs=self.tools_specs,  # Likely empty, factory will fetch
                model_name=self.current_model_name,
                agent_type=self.agent_type,
                command_desc=self.command_desc,
                web_search=False,  # Default
                thinking=self.current_thinking,
                user_id=rag_user_id,
                chat_id=self.chat_id,
                endpoint=endpoint,
                client_tool_runner=client_tool_runner,
            )
        except Exception as e:
            logger.error(
                "[RedisSession] Failed to build agent: %s",
                e,
                exc_info=True,
                extra={
                    "chat_id": self.chat_id,
                    "user_id": self.user_id,
                    "agent_type": self.agent_type,
                },
            )
            await self._send_frame(
                make_error(
                    self.next_id,
                    "build_failed",
                    self.chat_id,
                    f"Failed to build agent: {str(e)}",
                    http=500,
                    details={
                        "error_type": type(e).__name__,
                        "agent_type": self.agent_type,
                        "chat_id": self.chat_id,
                        "user_id": self.user_id,
                    },
                )
            )
            raise

    def _parse_tools(self, payload: Any):
        """Parse tools from payload."""
        if not payload:
            return
        if not isinstance(payload, dict):
            payload = payload if hasattr(payload, "__dict__") else {}

        tools_obj = payload.get("tools") if isinstance(payload, dict) else None
        tools_data: list[Any] = []

        if isinstance(tools_obj, dict):
            tools_data = tools_obj.get("tools", [])
        elif isinstance(tools_obj, list):
            tools_data = tools_obj

        if isinstance(tools_data, list):
            for tool_dict in tools_data:
                self._parse_tool_item(tool_dict)

        # Also check for command/team desc in payload
        cmd_obj = payload.get("command") if isinstance(payload, dict) else None
        if cmd_obj is None and isinstance(payload, dict):
            cmd_obj = payload.get("team")

        if cmd_obj:
            if isinstance(cmd_obj, str):
                try:
                    cmd_obj = json.loads(cmd_obj)
                except json.JSONDecodeError:
                    pass
            if isinstance(cmd_obj, dict):
                self.command_desc = cmd_obj
                # If model is not set, set it from command
                if self.current_model_name is None:
                    self.current_model_name = cmd_obj.get("model")

        tool_names = [t.name for t in self.tools_specs]
        logger.info(
            "[RedisSession] Parsed tools: count=%d, names=%s",
            len(self.tools_specs),
            tool_names,
        )

    def _parse_tool_item(self, tool_dict: Any):
        """Parse a single tool item from the tools list."""
        if not isinstance(tool_dict, dict):
            return
        try:
            params = self._extract_tool_params(tool_dict)

            logger.info(
                "[RedisSession] Parsed tool item: name=%s, has_creds=%s, has_token=%s",
                tool_dict.get("name"),
                "creds" in params or "creds" in tool_dict,
                "access_token" in params or "token" in params,
            )

            tool_spec = ToolSpec(
                name=tool_dict.get("name", ""),
                provider=tool_dict.get("provider"),
                enabled=tool_dict.get("enabled", True),
                params=params if isinstance(params, dict) else {},
            )
            self.tools_specs.append(tool_spec)
            logger.debug(
                "[RedisSession] Parsed tool: name=%s, enabled=%s, params_keys=%s",
                tool_spec.name,
                tool_spec.enabled,
                list(params.keys()),
            )
        except Exception as e:
            logger.warning("[RedisSession] Failed to parse tool: %s", e)

    def _extract_tool_params(self, tool_dict: dict) -> dict:
        """Extract and normalize tool parameters from tool dictionary."""
        # First try nested "params" key
        params = tool_dict.get("params", {})
        if isinstance(params, str):
            try:
                params = json.loads(params)
            except json.JSONDecodeError:
                params = {}

        # IMPORTANT: Also merge top-level keys (like user_id) into params
        # Go sends: {"name": "knowledge_search", "enabled": true, "user_id": "..."}
        # So user_id is at top level, not inside "params"
        for key in (
            "user_id",
            "list_id",  # list chat: manage list items via agent
            "access_token",
            "token",
            "auth_token",
            "creds",
            "account_email",
            "api_key",  # Jules API key from frontend
        ):
            if key in tool_dict and key not in params:
                params[key] = tool_dict[key]

        return params

    def _parse_history(self, payload: Any):
        if payload and isinstance(payload, dict):
            history_data = payload.get("history", [])
            if isinstance(history_data, list):
                for msg in history_data:
                    if isinstance(msg, dict):
                        self.chat_history.append(
                            {
                                "role": msg.get("role", "user"),
                                "content": msg.get("text") or msg.get("content", ""),
                            }
                        )
                logger.info(
                    "[RedisSession] Parsed history: count=%d, first_role=%s, last_role=%s",
                    len(self.chat_history),
                    self.chat_history[0]["role"] if self.chat_history else "N/A",
                    self.chat_history[-1]["role"] if self.chat_history else "N/A",
                )

    async def _extract_and_store_facts(self, text: str) -> None:
        """
        Run memory extraction in background: extract facts from current message + recent
        history and store in shared Knowledge with user_id in metadata. Does not block the main chat response.
        """
        user_id = self.user_id
        if not user_id or not (text or "").strip():
            return
        try:
            # Access _knowledge directly from agent_factory (it's a private attribute)
            knowledge = getattr(self.agent_factory, "_knowledge", None)
            if not knowledge:
                return

            # Check if db is available
            db = getattr(self.agent_factory, "_db", None)
            if db is None:
                logger.debug("[RedisSession] No database available for fact extraction")
                return

            model = self.agent_factory.build_model(
                self.current_model_name or "gemini-2.0-flash",
                thinking="off",
            )

            memoriser = SouperAgent(
                db=db,
                model=model,
                knowledge=knowledge,
                debug_mode=getattr(self.agent_factory, "_debug_mode", False),
            )
            last_n = 5
            history_snippet = ""
            if self.chat_history:
                recent = self.chat_history[-last_n:]
                lines = [
                    f"{'User' if h['role'] == 'user' else 'Assistant'}: {h['content']}"
                    for h in recent
                ]
                history_snippet = "Conversation:\n" + "\n".join(lines) + "\n\n"
            prompt = (
                f"{history_snippet}User message: {text.strip()}\n\n"
                "Extract 0-5 facts/preferences/constraints to remember (one per line, clear standalone statements)."
            )
            response = await memoriser.arun(prompt, stream=False)
            content = getattr(response, "content", None) or ""
            if isinstance(content, str):
                for line in content.splitlines():
                    fact = line.strip()
                    if not fact or len(fact) < 3:
                        continue
                    if fact.startswith(("-", "*", "•", "1.", "2.", "3.", "4.", "5.")):
                        fact = fact.lstrip("-*•0123456789. ")
                    if fact:
                        try:
                            knowledge.insert(
                                text_content=fact,
                                metadata={"user_id": user_id},
                            )
                            logger.info("[RedisSession] Stored fact: %s", fact[:80])
                        except Exception as e:
                            logger.warning(
                                "[RedisSession] Failed to store fact %s: %s",
                                fact[:50],
                                e,
                            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning(
                "[RedisSession] Memory extraction failed (non-fatal): %s",
                e,
                exc_info=False,
                extra={"user_id": user_id},
            )

    async def handle_user_message(self, frame: Frame):
        payload = frame.payload or {}
        text = payload.get("message", "")
        message_id = str(uuid.uuid4())

        # --- NEW LOGIC: Init from Payload ---

        # Reset delivery context at the start of each request
        self._delivery_source = None
        self._delivery_context = {}

        # 0. Extract user_id first (critical for RAG)
        incoming_user_id = payload.get("user_id")
        if incoming_user_id:
            self.user_id = str(incoming_user_id)
            logger.info("[RedisSession] Updated user_id from payload: %s", self.user_id)

        # 0b. Extract plugin delivery context from payload
        self._delivery_source = payload.get("source")
        if self._delivery_source:
            # Collect all plugin-specific context keys from payload
            standard_keys = {"message", "role", "user_id", "source", "message_id", "trace_id",
                             "history", "tools", "command", "team", "attachments", "extracted_facts"}
            self._delivery_context = {k: v for k, v in payload.items() if k not in standard_keys}
            logger.info(
                "[RedisSession] Delivery source=%s, context_keys=%s",
                self._delivery_source,
                list(self._delivery_context.keys()),
            )

        # 1. Check and update chat history
        incoming_history = payload.get("history")
        if incoming_history:
            # Wrap in dict to match _parse_history expectation or change _parse_history
            # The Go side sends "History": [...] which arrives as payload["history"] = [...]
            # _parse_history expects {"history": [...]} or just the payload if it contains "history"
            self._parse_history(payload)

        # 2. Check and update tools/commands
        if payload.get("tools") or payload.get("command") or payload.get("team"):
            logger.info("[RedisSession] Found tools/command in payload, parsing")
            self._parse_tools(payload)
            # If tools updated, we might need to assume agent needs rebuild (which happens below anyway)

        # ------------------------------------

        # Build agent
        await self.build_agent_instance(payload)

        # Optionally store client-extracted facts from payload (e.g. from sync path)
        incoming_facts = payload.get("extracted_facts")
        if incoming_facts and self.user_id:
            try:
                knowledge = getattr(self.agent_factory, "_knowledge", None)
                if knowledge and isinstance(incoming_facts, list):
                    for fact in incoming_facts:
                        if isinstance(fact, str) and fact.strip():
                            try:
                                knowledge.insert(
                                    text_content=fact.strip(),
                                    metadata={"user_id": str(self.user_id)},
                                )
                                logger.info(
                                    "[RedisSession] Stored client fact: %s", fact[:80]
                                )
                            except Exception as e:
                                logger.warning(
                                    "[RedisSession] Failed to store client fact: %s", e
                                )
            except Exception as e:
                logger.warning("[RedisSession] Failed to store extracted_facts: %s", e)

        # Run memory extraction in background (does not block response)
        if payload.get("role") != "system":
            asyncio.create_task(self._extract_and_store_facts(text))

        # If we have history and the agent supports it, we might want to load it.
        # But commonly the Agent loads from DB based on session_id.
        # If we want to use the push-history, we might need to manually set it.
        # However, for now, we follow the user's request to just parse it.

        msg_chat_id = frame.chat_id or self.chat_id

        # Send Meta (Empty message bubble fix: Frontend filters it, but backend needs to reserve ID?)
        # Actually, Go backend already has the message ID from the user?
        # No, this message_id is for the Response.
        # We still send it.
        # FIX: Added "type": "metadata" to satisfy Go backend validation
        await self._send_frame(
            make_meta(
                self.next_id,
                Op.MESSAGE,
                msg_chat_id,
                {"message_id": message_id, "type": "metadata"},
            )
        )

        self._last_run_completed_content = None
        idx = 0
        done_sent = False

        # Resolve delivery handler for external channels (e.g. Telegram)
        from src.server.delivery import DeliveryRegistry

        delivery_handler = (
            DeliveryRegistry.get(self._delivery_source)
            if self._delivery_source
            else None
        )
        delivery_text_buffer: list[str] = []

        try:
            # Stream agent events for real-time response
            stream_iter = self._stream_agent_events(text, payload.get("attachments"))
            async for event in stream_iter:
                if self.cancel_event.is_set():
                    break

                evt_type = event.get("type")

                if evt_type == "content_done":
                    # Content generation is complete — send DONE immediately
                    # without waiting for learning/memory background tasks.
                    done_payload: dict[str, Any] = {"message_id": message_id}
                    completed_content = getattr(
                        self, "_last_run_completed_content", None
                    )
                    if completed_content is not None:
                        done_payload["content"] = str(completed_content)
                    await self._send_frame(
                        make_done(self.next_id, msg_chat_id, done_payload)
                    )
                    done_sent = True

                    # Deliver to external channel via plugin delivery handler
                    if delivery_handler:
                        full_text = "".join(delivery_text_buffer)
                        if not full_text and completed_content:
                            full_text = str(completed_content)
                        if full_text:
                            await delivery_handler.deliver(
                                full_text, self._delivery_context
                            )

                    # Drain the remaining stream in background so learning/memory
                    # tasks can finish without blocking the client.
                    async def _drain_remaining(it):
                        try:
                            async for ev in it:
                                # Process RunCompleted to capture final content
                                ev_type = (
                                    ev.get("type") if isinstance(ev, dict) else None
                                )
                                if ev_type == "text" and ev.get("content"):
                                    # Late text after content_done — update stored content
                                    pass
                        except asyncio.CancelledError:
                            raise
                        except Exception as e:
                            logger.warning(
                                "[RedisSession] Error draining post-done stream: %s", e
                            )

                    asyncio.create_task(_drain_remaining(stream_iter))
                    break

                elif evt_type == "text":
                    chunk = event.get("content", "")
                    agent_name = event.get("agent_name")
                    if chunk:
                        if delivery_handler and delivery_handler.should_buffer():
                            delivery_text_buffer.append(chunk)
                        payload_data = {
                            "ix": idx,
                            "eof": False,
                            "message": chunk,
                            "message_id": message_id,
                        }
                        if agent_name:
                            payload_data["agent_name"] = agent_name
                        await self._send_frame(
                            make_data(
                                self.next_id, Op.MESSAGE, msg_chat_id, payload_data
                            )
                        )
                        idx += 1

                elif evt_type == "member_response":
                    chunk = event.get("content", "")
                    if chunk:
                        if delivery_handler and delivery_handler.should_buffer():
                            delivery_text_buffer.append(chunk)
                        # Send as a regular message part, but you might want to mark it
                        # so the frontend knows who sent it.
                        payload_data = {
                            "ix": idx,
                            "eof": False,
                            "message": chunk,
                            "message_id": message_id,
                            "agent_name": event.get("agent_name"),  # Pass agent name
                            "type": "member_response",
                        }
                        await self._send_frame(
                            make_data(
                                self.next_id, Op.MESSAGE, msg_chat_id, payload_data
                            )
                        )
                        idx += 1

                elif evt_type == "tool_call":
                    tool_data = event.get("tool", {})
                    safe_tool = {
                        "name": getattr(tool_data, "tool_name", "unknown")
                        if hasattr(tool_data, "tool_name")
                        else tool_data.get("name", "unknown"),
                        "arguments": getattr(tool_data, "tool_args", {})
                        if hasattr(tool_data, "tool_args")
                        else tool_data.get("arguments", {}),
                        "result": getattr(tool_data, "result", None)
                        if hasattr(tool_data, "result")
                        else tool_data.get("result", None),
                    }

                    # Handle mock/legacy
                    if hasattr(tool_data, "name") and not isinstance(tool_data, dict):
                        safe_tool["name"] = tool_data.name

                    # Handle suggest_actions
                    # ... (Omitting complex suggestion logic for MVP, can add if needed)

                    await self._send_frame(
                        make_data(
                            self.next_id,
                            Op.MESSAGE,
                            msg_chat_id,
                            {
                                "type": "tool_call",
                                "tool": safe_tool,
                                "message_id": message_id,
                                "agent_name": event.get("agent_name"),
                            },
                        )
                    )

                elif evt_type == "reasoning":
                    content = event.get("content", "")
                    agent_name = event.get("agent_name")
                    if content:
                        payload_data = {
                            "type": "reasoning",
                            "content": content,
                            "message_id": message_id,
                        }
                        if agent_name:
                            payload_data["agent_name"] = agent_name
                        await self._send_frame(
                            make_data(
                                self.next_id, Op.MESSAGE, msg_chat_id, payload_data
                            )
                        )

                elif evt_type == "error":
                    # Handle agent errors (e.g., RunErrorEvent from Agno)
                    error_message = event.get("message", "Agent execution failed")
                    error_code = event.get("code", "agent_error")
                    error_details = event.get("details", {})
                    error_http = event.get("http", 500)

                    logger.error(
                        "[RedisSession] Agent error event: %s",
                        error_message,
                        extra={
                            "chat_id": msg_chat_id,
                            "user_id": self.user_id,
                            "error_code": error_code,
                            "error_details": error_details,
                        },
                    )

                    await self._send_frame(
                        make_error(
                            self.next_id,
                            error_code,
                            msg_chat_id,
                            error_message,
                            http=error_http,
                            details=error_details,
                        )
                    )
                    # Don't send done frame after error - error frame is terminal
                    return

            # Fallback: if content_done was never received (e.g. older Agno
            # version or non-streaming agent), send DONE after the stream ends.
            if not done_sent:
                done_payload_fb: dict[str, Any] = {"message_id": message_id}
                completed_content = getattr(self, "_last_run_completed_content", None)
                if completed_content is not None:
                    done_payload_fb["content"] = str(completed_content)
                await self._send_frame(
                    make_done(self.next_id, msg_chat_id, done_payload_fb)
                )
                # Deliver to external channel via plugin delivery handler (fallback path)
                if delivery_handler:
                    full_text = "".join(delivery_text_buffer)
                    if not full_text and completed_content:
                        full_text = str(completed_content)
                    if full_text:
                        await delivery_handler.deliver(
                            full_text, self._delivery_context
                        )

        except asyncio.CancelledError:
            logger.info("[RedisSession] Streaming cancelled by user")
            raise  # Re-raise to propagate cancellation
        except Exception as e:
            trace_id = frame.trace_id if hasattr(frame, "trace_id") else None
            logger.error(
                "[RedisSession] Error streaming: %s",
                e,
                exc_info=True,
                extra={
                    "chat_id": msg_chat_id,
                    "user_id": self.user_id,
                    "trace_id": trace_id,
                },
            )
            await self._send_frame(
                make_error(
                    self.next_id,
                    "stream_failed",
                    msg_chat_id,
                    f"Streaming failed: {str(e)}",
                    http=500,
                    details={
                        "error_type": type(e).__name__,
                        "chat_id": msg_chat_id,
                        "user_id": self.user_id,
                        "trace_id": trace_id,
                    },
                )
            )

    async def _stream_agent_events(
        self, text: str, attachments: list | None
    ) -> AsyncIterator[dict]:
        """Stream agent events and yield formatted event dictionaries."""
        # Prepare inputs
        kwargs: dict[str, Any] = {}
        # Only pass session_id for non-team mode
        if (
            self.session_id
            and self.command_desc
            and self.command_desc.get("type", "agent") != "team"
        ):
            kwargs["session_id"] = self.session_id

        agent_input = self._build_agent_input(text)

        if attachments:
            images = self._process_attachments(attachments)
            if images:
                kwargs["images"] = images

        agent = self.agent
        if not agent:
            raise ValueError("Agent not initialized")

        # Log what we're sending to the agent
        logger.info(
            "[RedisSession] Calling agent with: text=%s, kwargs=%s",
            text[:50] if text else "None",
            kwargs.keys(),
        )

        result = await self._invoke_agent(agent, agent_input, kwargs)
        if not result:
            return

        # Iterate stream
        async for event in self._iterate_agent_stream(result):
            yield event

    def _build_agent_input(self, text: str) -> str:
        """Build agent input with conversation history context."""
        if not self.chat_history:
            return text

        try:
            # Format history as conversation context
            # Make it clear this is the ACTUAL conversation history the model should reference
            history_lines = []
            for h in self.chat_history:
                role = "User" if h["role"] == "user" else "You"
                content = h["content"]
                history_lines.append(f"{role}: {content}")

            history_context = "\n".join(history_lines)

            # Format with clear instructions that this IS the conversation
            if text:
                return f"""[IMPORTANT: The following is your conversation history with this user. Use it to answer questions about previous messages.]

--- Previous messages in this conversation ---
{history_context}
--- End of conversation history ---

User's new message: {text}"""
            else:
                return f"""[IMPORTANT: Continue the conversation based on history below.]

--- Previous messages ---
{history_context}
--- End ---

Continue the conversation."""

        except Exception as e:
            logger.error("[RedisSession] Failed to inject history: %s", e)
            return text

    def _process_attachments(self, attachments: list) -> list[Image]:
        """Process attachments and extract images."""
        images = []
        for att in attachments:
            if isinstance(att, dict) and att.get("file_type", "").startswith("image/"):
                import base64

                try:
                    content = att.get("content", "")
                    if content:
                        image_bytes = base64.b64decode(content)
                        images.append(
                            Image(content=image_bytes, format=att.get("file_type"))
                        )
                except Exception as e:
                    logger.error("[RedisSession] Image decode error: %s", e)
        return images

    async def _invoke_agent(
        self, agent: Any, agent_input: str, kwargs: dict[str, Any]
    ) -> Any:
        """Invoke the agent with the given input and return the result."""

        # Helper to decide if we should await
        async def run_fn(fn):
            inp = agent_input
            if isinstance(inp, str):
                inp = (
                    inp if (inp and inp.strip()) else "[continue from previous context]"
                )

            if asyncio.iscoroutinefunction(fn):
                return await fn(inp, stream=True, stream_events=True, **kwargs)
            return fn(inp, stream=True, stream_events=True, **kwargs)

        result = None
        try:
            if hasattr(agent, "arun"):
                result = await run_fn(agent.arun)
            elif hasattr(agent, "run"):
                result = await run_fn(agent.run)
            else:
                for m in ("generate", "respond", "chat"):
                    fn = getattr(agent, m, None)
                    if fn:
                        result = await run_fn(fn)
                        break
        except Exception as e:
            # Check for dangling tool call error from OpenAI (Error 400)
            # Message: 'No tool output found for function call call_...'
            if "No tool output found" in str(e) and "call_" in str(e):
                logger.warning(
                    "[RedisSession] Detected dangling tool call error. Attempting repair..."
                )
                try:
                    repaired = await self._repair_dangling_tool_calls(agent)
                    if repaired:
                        logger.info(
                            "[RedisSession] History repaired. Retrying agent invocation..."
                        )
                        # Retry invocation
                        if hasattr(agent, "arun"):
                            result = await run_fn(agent.arun)
                        elif hasattr(agent, "run"):
                            result = await run_fn(agent.run)
                        else:
                            for m in ("generate", "respond", "chat"):
                                fn = getattr(agent, m, None)
                                if fn:
                                    result = await run_fn(fn)
                                    break
                        # If retry succeeded, return result
                        if result:
                            return result
                except Exception as repair_err:
                    logger.error("[RedisSession] Repair/Retry failed: %s", repair_err)
                    # Fall through to original error handling

            logger.error(
                "[RedisSession] Agent invocation failed: %s",
                e,
                exc_info=True,
                extra={"chat_id": self.chat_id, "user_id": self.user_id},
            )
            # Send error frame before raising
            try:
                msg_chat_id = self.chat_id
                await self._send_frame(
                    make_error(
                        self.next_id,
                        "agent_failed",
                        msg_chat_id,
                        f"Agent invocation failed: {str(e)}",
                        http=500,
                        details={
                            "error_type": type(e).__name__,
                            "chat_id": msg_chat_id,
                            "user_id": self.user_id,
                        },
                    )
                )
            except Exception as send_err:
                logger.error("[RedisSession] Failed to send error frame: %s", send_err)
            raise

        if not result:
            logger.error(
                "[RedisSession] No callable method found on agent",
                extra={"chat_id": self.chat_id, "user_id": self.user_id},
            )
            # Send error frame
            try:
                msg_chat_id = self.chat_id
                await self._send_frame(
                    make_error(
                        self.next_id,
                        "agent_not_found",
                        msg_chat_id,
                        "No callable method found on agent",
                        http=500,
                        details={
                            "chat_id": msg_chat_id,
                            "user_id": self.user_id,
                        },
                    )
                )
            except Exception as send_err:
                logger.error("[RedisSession] Failed to send error frame: %s", send_err)

        return result

    async def _repair_dangling_tool_calls(self, agent: Any) -> bool:
        """Repairs dangling tool calls in agent history."""
        # Unwrap if needed
        real_agent = agent
        if hasattr(agent, "_agent"):
            real_agent = agent._agent

        # Load history to ensure we have the latest (including the bad state)
        if hasattr(real_agent, "read_chat_history"):
            try:
                if asyncio.iscoroutinefunction(real_agent.read_chat_history):
                    await real_agent.read_chat_history()
                else:
                    real_agent.read_chat_history()
            except Exception as e:
                logger.warning("[RedisSession] Failed to read chat history: %s", e)

        if not hasattr(real_agent, "memory") or not real_agent.memory:
            return False

        messages = real_agent.memory.messages
        if not messages:
            return False

        from agno.models.message import Message

        repaired = False
        # Iterate backwards to find assistant messages with tool calls
        for i in range(len(messages) - 1, -1, -1):
            msg = messages[i]
            if msg.role == "assistant" and msg.tool_calls:
                tool_calls = msg.tool_calls
                covered_ids = set()

                # Look ahead for tool outputs
                for j in range(i + 1, len(messages)):
                    next_msg = messages[j]
                    if next_msg.role == "tool" and next_msg.tool_call_id:
                        covered_ids.add(next_msg.tool_call_id)

                # Find missing
                missing_ids = []
                for tc in tool_calls:
                    tc_id = None
                    if isinstance(tc, dict):
                        tc_id = tc.get("id")
                    elif hasattr(tc, "id"):
                        tc_id = tc.id
                    elif hasattr(tc, "tool_call_id"):
                        tc_id = tc.tool_call_id

                    if tc_id and tc_id not in covered_ids:
                        missing_ids.append(tc_id)

                if missing_ids:
                    logger.info(
                        "[RedisSession] Found missing outputs for: %s", missing_ids
                    )
                    for missing_id in missing_ids:
                        dummy_msg = Message(
                            role="tool",
                            tool_call_id=missing_id,
                            content="Tool execution interrupted. Please retry.",
                        )
                        real_agent.memory.add_message(dummy_msg)
                    repaired = True

        if repaired:
            # Save to storage so retry works (as it might reload)
            try:
                if hasattr(real_agent, "asave_session"):
                    await real_agent.asave_session()
                elif hasattr(real_agent, "save_session"):
                    real_agent.save_session()
                logger.info("[RedisSession] Saved repaired history to storage")
            except Exception as e:
                logger.error("[RedisSession] Failed to save repaired history: %s", e)

        return repaired

    async def _iterate_agent_stream(self, result: Any) -> AsyncIterator[dict]:
        """Iterate over agent result stream and yield formatted events."""
        if hasattr(result, "__aiter__"):
            async for event in self._process_async_stream(result):
                yield event
        elif hasattr(result, "__iter__") and not isinstance(result, (str, bytes)):
            # Sync iterator fallback
            for ev in result:
                # Simplified sync handling
                pass
        else:
            # Single value fallback
            chunk = str(result)
            if chunk:
                yield {"type": "text", "content": chunk}

    async def _process_async_stream(self, result: Any) -> AsyncIterator[dict]:
        """Process async stream of agent events."""
        streamed_text_len = 0
        current_agent_name: str | None = (
            None  # Track current agent for context switching
        )
        last_yielded_text = ""  # Skip duplicate consecutive text chunks
        last_yielded_reasoning = ""  # Skip duplicate consecutive reasoning chunks
        accumulated_text = ""  # For APIs that send cumulative content instead of deltas (e.g. OpenCode)
        accumulated_reasoning = ""  # Same for reasoning stream

        async for ev in result:
            if self.cancel_event.is_set():
                logger.info("[RedisSession] Stream cancelled by event flag")
                break

            event_type = type(ev).__name__
            logger.info("[RedisSession] Stream event received: %s", event_type)
            logger.debug("[RedisSession] Event details: %s", ev)

            # Check if this is a member agent event
            agent_id = getattr(ev, "agent_id", None)
            agent_name = getattr(ev, "agent_name", None) or agent_id
            is_member_event = agent_id is not None

            # Log agent switching for multi-agent teams
            if agent_name and agent_name != current_agent_name:
                logger.info(
                    "[Team] Agent switched: %s → %s",
                    current_agent_name or "Team Leader",
                    agent_name,
                )
                # Send separator between different agent responses to prevent text gluing
                if current_agent_name is not None:
                    yield {"type": "text", "content": "\n\n"}
                current_agent_name = agent_name
                # Reset accumulated stream state so new agent's content is not compared to previous
                accumulated_text = ""
                accumulated_reasoning = ""
                last_yielded_text = ""
                last_yielded_reasoning = ""

            # Process different event types
            async for event in self._handle_tool_call_events(
                ev, event_type, current_agent_name
            ):
                yield event

            async for event in self._handle_reasoning_event(
                ev,
                event_type,
                current_agent_name,
                accumulated_reasoning,
                last_yielded_reasoning,
            ):
                if event.get("content"):
                    accumulated_reasoning = event.get(
                        "_accumulated", accumulated_reasoning
                    )
                    last_yielded_reasoning = event.get(
                        "_last_yielded", last_yielded_reasoning
                    )
                    # Clean up internal tracking fields
                    event.pop("_accumulated", None)
                    event.pop("_last_yielded", None)
                yield event

            # RunContentCompleted arrives BEFORE learning/memory tasks finish,
            # so we use it as the "content is ready" signal to unblock DONE.
            if "RunContentCompleted" in event_type:
                yield {"type": "content_done"}

            async for event in self._handle_run_completed_event(
                ev, event_type, current_agent_name, streamed_text_len
            ):
                if event.get("type") == "text" and event.get("content"):
                    streamed_text_len += len(str(event.get("content")))
                yield event

            async for event in self._handle_workflow_event(
                ev, event_type, streamed_text_len
            ):
                if event.get("type") == "text" and event.get("content"):
                    streamed_text_len += len(str(event.get("content")))
                yield event

            async for event in self._handle_text_chunk_event(
                ev,
                event_type,
                current_agent_name,
                agent_id,
                is_member_event,
                accumulated_text,
                last_yielded_text,
                streamed_text_len,
            ):
                if event.get("content"):
                    accumulated_text = str(event.get("_accumulated", accumulated_text))
                    last_yielded_text = str(
                        event.get("_last_yielded", last_yielded_text)
                    )
                    new_len = event.get("_streamed_len")
                    if new_len is not None:
                        streamed_text_len = int(new_len)
                    # Clean up internal tracking fields
                    event.pop("_accumulated", None)
                    event.pop("_last_yielded", None)
                    event.pop("_streamed_len", None)
                yield event

            # Track active agents
            if "RunStarted" in event_type and agent_name:
                self.active_agents.add(agent_name)
                asyncio.create_task(self._broadcast_system_status())

            elif "RunCompleted" in event_type and agent_name:
                if agent_name in self.active_agents:
                    self.active_agents.discard(agent_name)
                    asyncio.create_task(self._broadcast_system_status())
                # Reset current_agent_name so next content goes to Team Lead
                current_agent_name = None

            # Handle error events
            async for event in self._handle_agent_error_event(ev, event_type):
                yield event

    def _extract_tool_data(self, tool_obj: Any) -> dict:
        """Extract tool data from various formats (dict or object)."""
        if not tool_obj:
            return {
                "id": None,
                "name": "unknown",
                "arguments": {},
                "result": None,
                "status": "unknown",
            }

        if isinstance(tool_obj, dict):
            tool_name = tool_obj.get("tool_name") or tool_obj.get("name") or "unknown"
            tool_args = tool_obj.get("tool_args") or tool_obj.get("arguments") or {}
            tool_result = tool_obj.get("result")
            tool_id = (
                tool_obj.get("tool_call_id")
                or tool_obj.get("call_id")
                or tool_obj.get("id")
            )
        else:
            tool_name = getattr(tool_obj, "tool_name", None) or getattr(
                tool_obj, "name", "unknown"
            )
            tool_args = getattr(tool_obj, "tool_args", {})
            tool_result = getattr(tool_obj, "result", None)
            tool_id = (
                getattr(tool_obj, "tool_call_id", None)
                or getattr(tool_obj, "call_id", None)
                or getattr(tool_obj, "id", None)
            )

        return {
            "id": tool_id,
            "name": tool_name,
            "arguments": tool_args,
            "result": tool_result,
            "status": "completed",
        }

    async def _handle_tool_call_events(
        self, ev: Any, event_type: str, current_agent_name: str | None
    ) -> AsyncIterator[dict]:
        """Handle tool call started and completed events."""
        # ToolCallStarted
        if "ToolCallStarted" in event_type:
            tool_obj = ev.tool if ev.tool else None

            if tool_obj:
                if isinstance(tool_obj, dict):
                    tool_name = (
                        tool_obj.get("tool_name") or tool_obj.get("name") or "unknown"
                    )
                    tool_args = (
                        tool_obj.get("tool_args") or tool_obj.get("arguments") or {}
                    )
                    tool_id = (
                        tool_obj.get("tool_call_id")
                        or tool_obj.get("call_id")
                        or tool_obj.get("id")
                    )
                else:
                    tool_name = getattr(tool_obj, "tool_name", None) or getattr(
                        tool_obj, "name", "unknown"
                    )
                    tool_args = getattr(tool_obj, "tool_args", {})
                    tool_id = (
                        getattr(tool_obj, "tool_call_id", None)
                        or getattr(tool_obj, "call_id", None)
                        or getattr(tool_obj, "id", None)
                    )
            else:
                tool_name = "unknown"
                tool_args = {}
                tool_id = None

            logger.info(
                "[RedisSession] Tool call started: %s (id=%s)", tool_name, tool_id
            )
            tool_data = {
                "type": "tool_call",
                "tool": {
                    "id": tool_id,
                    "name": tool_name,
                    "arguments": tool_args,
                    "status": "running",
                },
            }
            if current_agent_name:
                tool_data["agent_name"] = current_agent_name
            yield tool_data

        # ToolCallCompleted
        elif "ToolCallCompleted" in event_type:
            if hasattr(ev, "tool") and ev.tool:
                tool_dict = self._extract_tool_data(ev.tool)

                logger.info(
                    "[RedisSession] Tool call completed: %s (id=%s)",
                    tool_dict["name"],
                    tool_dict["id"],
                )

                tool_data = {"type": "tool_call", "tool": tool_dict}
                if current_agent_name:
                    tool_data["agent_name"] = current_agent_name
                yield tool_data
                # Add separator after tool call to prevent text gluing
                yield {"type": "text", "content": "\n\n"}

    async def _handle_reasoning_event(
        self,
        ev: Any,
        event_type: str,
        current_agent_name: str | None,
        accumulated_reasoning: str,
        last_yielded_reasoning: str,
    ) -> AsyncIterator[dict]:
        """Handle reasoning/thinking events from various sources."""
        captured_reasoning = self._extract_reasoning_content(ev, event_type)

        if captured_reasoning:
            # Handle cumulative stream: if chunk extends previous, yield only the new suffix
            if captured_reasoning.startswith(accumulated_reasoning) and len(
                captured_reasoning
            ) > len(accumulated_reasoning):
                to_yield = captured_reasoning[len(accumulated_reasoning) :]
                new_accumulated = captured_reasoning
            else:
                to_yield = captured_reasoning
                new_accumulated = accumulated_reasoning + to_yield

            if to_yield and to_yield != last_yielded_reasoning:
                reasoning_data = {
                    "type": "reasoning",
                    "content": to_yield,
                    "agent_name": current_agent_name,
                    "_accumulated": new_accumulated,
                    "_last_yielded": to_yield,
                }
                yield reasoning_data

    def _extract_reasoning_content(self, ev: Any, event_type: str) -> str | None:
        """Extract reasoning content from various event formats."""
        # Check for Agno's reasoning_content attribute
        if hasattr(ev, "reasoning_content") and ev.reasoning_content:
            logger.debug(
                "[RedisSession] Found reasoning_content: %d chars",
                len(ev.reasoning_content),
            )
            return ev.reasoning_content

        # Check for thinking_content (Gemini native thinking)
        if hasattr(ev, "thinking_content") and ev.thinking_content:
            logger.debug(
                "[RedisSession] Found thinking_content: %d chars",
                len(ev.thinking_content),
            )
            return ev.thinking_content

        # Check for thinking attribute (older format)
        if hasattr(ev, "thinking") and ev.thinking:
            logger.debug("[RedisSession] Found thinking: %d chars", len(ev.thinking))
            return ev.thinking

        # Check for content in Reasoning* event types
        if ("Reasoning" in event_type or "Thinking" in event_type) and hasattr(
            ev, "content"
        ):
            if ev.content:
                logger.debug(
                    "[RedisSession] Found reasoning from %s: %d chars",
                    event_type,
                    len(ev.content),
                )
                return ev.content

        # Also check delta field for streaming reasoning
        if hasattr(ev, "delta") and "Reasoning" in event_type:
            logger.debug(
                "[RedisSession] Found reasoning delta: %d chars",
                len(str(ev.delta)),
            )
            return ev.delta

        return None

    async def _handle_run_completed_event(
        self,
        ev: Any,
        event_type: str,
        current_agent_name: str | None,
        streamed_text_len: int,
    ) -> AsyncIterator[dict]:
        """Handle RunCompletedEvent - contains full message content."""
        if "RunCompleted" not in event_type:
            return

        val = getattr(ev, "content", None)
        if val:
            self._last_run_completed_content = str(val)
        if val and len(str(val)) > streamed_text_len:
            remainder = str(val)[streamed_text_len:]
            if remainder.strip():
                logger.info(
                    "[RedisSession] Sending remaining content from RunCompleted: %s...",
                    remainder[:50],
                )
                # Check if it looks like reasoning
                if remainder.strip().startswith(
                    "My thinking process"
                ) or remainder.strip().startswith("Thinking Process:"):
                    yield {
                        "type": "reasoning",
                        "content": remainder,
                        "agent_name": current_agent_name,
                    }
                else:
                    yield {
                        "type": "text",
                        "content": remainder,
                        "agent_name": current_agent_name,
                    }

    async def _handle_workflow_event(
        self, ev: Any, event_type: str, streamed_text_len: int
    ) -> AsyncIterator[dict]:
        """Handle workflow events (StepCompletedEvent and WorkflowCompletedEvent)."""
        # StepCompletedEvent contains the output of each step (agent)
        if "StepCompletedEvent" in event_type:
            # Get content from the event
            val = getattr(ev, "content", None)
            step_name = getattr(ev, "step_name", None)

            # Also check step_response for nested content
            step_response = getattr(ev, "step_response", None)
            if step_response and not val:
                val = getattr(step_response, "content", None)

            if val and str(val).strip():
                content = str(val)
                logger.info(
                    "[RedisSession] StepCompletedEvent content from %s: %s...",
                    step_name or "unknown",
                    content[:100],
                )
                # Skip yielding content here to avoid duplication with RunContentEvent
                # RunContentEvent + RunCompletedEvent already handle the streaming

        # WorkflowCompletedEvent contains the final aggregated result
        if "WorkflowCompletedEvent" in event_type:
            val = getattr(ev, "content", None)
            if val and str(val).strip():
                content = str(val)
                # Only yield if we haven't already streamed this content
                if len(content) > streamed_text_len:
                    remainder = content[streamed_text_len:]
                    if remainder.strip():
                        logger.info(
                            "[RedisSession] WorkflowCompletedEvent final content: %s...",
                            remainder[:100],
                        )
                        yield {"type": "text", "content": remainder}

    async def _handle_text_chunk_event(
        self,
        ev: Any,
        event_type: str,
        current_agent_name: str | None,
        agent_id: Any,
        is_member_event: bool,
        accumulated_text: str,
        last_yielded_text: str,
        streamed_text_len: int,
    ) -> AsyncIterator[dict]:
        """Handle text content streaming events (deltas only)."""
        # Exclude RunContentCompletedEvent: it contains "RunContentEvent" in its name
        # but carries full aggregated content; we must not re-send it to avoid duplication.
        if not (
            (
                "RunContentEvent" in event_type
                and "RunContentCompleted" not in event_type
            )
            or "ModelContentEvent" in event_type
            or "TextDeltaEvent" in event_type
            or "TextEvent" in event_type
        ):
            return

        val = None
        if hasattr(ev, "content"):
            val = ev.content
        elif hasattr(ev, "text"):
            val = ev.text
        elif hasattr(ev, "delta"):
            val = ev.delta

        chunk = str(val) if val is not None else ""

        if (
            chunk.startswith("```tool_outputs")
            or chunk.startswith('{"delegate_task_to_member')
            or "delegate_task_to_member_response" in chunk
        ):
            return

        # Get the current reasoning to avoid yielding reasoning as text
        captured_reasoning = self._extract_reasoning_content(ev, event_type)
        if chunk == captured_reasoning:
            return

        # Handle cumulative stream: if chunk extends previous, yield only the new suffix
        if chunk.startswith(accumulated_text) and len(chunk) > len(accumulated_text):
            to_yield = chunk[len(accumulated_text) :]
            new_accumulated = chunk
        else:
            to_yield = chunk
            new_accumulated = accumulated_text + to_yield

        if to_yield and to_yield != last_yielded_text:
            # Use current_agent_name to detect if we're in a member context
            is_member_context = (
                current_agent_name is not None
                and current_agent_name
                not in ("Team Lead", "Team Leader", "Development Team")
            )

            new_streamed_len = streamed_text_len + len(to_yield)
            if is_member_event or is_member_context:
                event = {
                    "type": "member_response",
                    "content": to_yield,
                    "agent_id": agent_id or current_agent_name,
                    "agent_name": agent_id or current_agent_name,
                    "_accumulated": new_accumulated,
                    "_last_yielded": to_yield,
                    "_streamed_len": new_streamed_len,
                }
            else:
                event = {
                    "type": "text",
                    "content": to_yield,
                    "agent_name": current_agent_name,
                    "_accumulated": new_accumulated,
                    "_last_yielded": to_yield,
                    "_streamed_len": new_streamed_len,
                }
            yield event

    async def _handle_agent_error_event(
        self, ev: Any, event_type: str
    ) -> AsyncIterator[dict]:
        """Handle RunErrorEvent from Agno agent."""
        if "RunError" not in event_type:
            return

        error_content = getattr(ev, "content", None)
        error_message = "Agent execution failed"
        error_code = "agent_error"
        error_details: dict[str, Any] = {}

        # Try to parse error content if it's JSON
        if error_content:
            try:
                if isinstance(error_content, str):
                    error_data = json.loads(error_content)
                else:
                    error_data = error_content

                # Extract error info from Agno's error format
                if isinstance(error_data, dict):
                    error_obj = error_data.get("error", {})
                    if isinstance(error_obj, dict):
                        error_message = error_obj.get("message", error_message)
                        error_code = error_obj.get("code", error_code)
                        error_status = error_obj.get("status", "")
                        if error_status:
                            error_code = error_status.lower().replace("_", "-")
                        error_details = {
                            "error_type": type(ev).__name__,
                            "agent_id": getattr(ev, "agent_id", None),
                            "run_id": getattr(ev, "run_id", None),
                            "raw_error": str(error_content)[:500],  # Limit size
                        }
            except Exception:
                # If parsing fails, use raw content as message
                error_message = str(error_content)[:500]
                error_details = {
                    "error_type": type(ev).__name__,
                    "raw_error": str(error_content)[:500],
                }

        logger.error(
            "[RedisSession] RunErrorEvent received: %s",
            error_message,
            extra={
                "chat_id": self.chat_id,
                "user_id": self.user_id,
                "error_code": error_code,
                "error_details": error_details,
            },
        )

        # Yield error event that will be handled in handle_user_message
        yield {
            "type": "error",
            "message": error_message,
            "code": error_code,
            "http": 500,
            "details": error_details,
        }
