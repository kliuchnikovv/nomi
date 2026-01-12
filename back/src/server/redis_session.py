import asyncio
import json
import logging
import os
import time
import uuid
import redis.asyncio as redis
from typing import Optional, List, Any, Dict

from agno.agent import Agent
from agno.models.message import Message
from src.agents.factory import AgentFactory
from src.server.models import Frame, Op
from src.server.utils import make_meta, make_error, make_done, make_data
from src.tools.models import ToolSpec
from src.tools.client_side import start_action_tracking

logger = logging.getLogger(__name__)

class RedisSession:
    """
    Handles a single request/response cycle or a session context via Redis.
    Mimics LLMWebSocketSession but for headless execution.
    """
    def __init__(self, agent_factory: AgentFactory, session_id: str, user_id: Optional[str] = None, chat_id: Optional[str] = None):
        self.agent_factory = agent_factory
        self.session_id = session_id
        self.user_id = user_id
        self.chat_id = chat_id or session_id
        
        self.redis_client = None
        self.agent: Optional[Agent] = None
        self.tools_specs: List[ToolSpec] = []
        
        # State (similar to WS session)
        self.current_model_name: Optional[str] = None
        self.current_thinking: str = "off"
        self.command_desc: Optional[dict] = None
        self.agent_type: Optional[str] = None
        
        # Initialize Redis for sending responses
        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        self.redis_client = redis.from_url(redis_url, decode_responses=True)
        self.next_id = 0
        self.next_id = 0
        self.cancel_event = asyncio.Event()

        # History storage
        self.chat_history: List[Dict[str, str]] = []

    async def _send_frame(self, frame: Frame) -> int:
        """Publish frame to Redis chat:user:<user_id>."""
        data = frame.marshal()
        # Target ID: User ID if known, else Session ID (fallback)
        target_id = self.user_id or self.session_id
        channel = f"chat:user:{target_id}"
        
        if self.redis_client:
            try:
                await self.redis_client.publish(channel, json.dumps(data))
                logger.info("[RedisSession] PUBLISH %s -> %s (len=%d)", channel, frame.op, len(data))
            except Exception as e:
                logger.error(f"[RedisSession] Publish failed: {e}")
        
        self.next_id = frame.id + 1
        return self.next_id

    async def handle_frame(self, frame: Frame):
        """Process an incoming frame."""
        try:
            if frame.op == Op.MESSAGE:
                await self.handle_user_message(frame)
            elif frame.op == Op.STOP:
                # We can't easily cancel a running task from another session instance unless we share state.
                # For now, Redis request is one-shot. STOP needs coordination.
                # If we want to support STOP via Redis, we need shared state (e.g. Redis key) or the worker keeps track.
                # The RedisWorker keeps track of tasks. But here we are inside a new Session instance.
                # This suggests RedisSession should probably be persistent or managed by Worker.
                # But for now, let's assume one-shot.
                pass
            else:
                logger.warning(f"[RedisSession] Unsupported op: {frame.op}")
        finally:
            if self.redis_client:
                await self.redis_client.close()

    async def build_agent_instance(self, payload: dict):
        """Build the agent based on payload parameters."""
        # Extract params from payload or defaults
        self.current_model_name = payload.get("model")
        
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
        
        rag_user_id = self.user_id or self.session_id

        try:
            # We assume Team mode if command_desc is present and has team info?
            # Or simplified building. using factory.build
            
            # Using same logic as WS
            self.agent = await self.agent_factory.build(
                session_id=self.session_id,
                tools_specs=self.tools_specs, # Likely empty, factory will fetch
                model_name=self.current_model_name,
                agent_type=self.agent_type,
                command_desc=self.command_desc,
                web_search=False, # Default
                thinking=self.current_thinking,
                user_id=rag_user_id,
                chat_id=self.chat_id,
            )
        except Exception as e:
            logger.error(f"[RedisSession] Failed to build agent: {e}")
            await self._send_frame(make_error(self.next_id, "build_failed", self.chat_id, str(e), 500))
            raise

    def _parse_tools(self, payload: Any):
        if not payload:
            return
        if not isinstance(payload, dict):
            payload = payload if hasattr(payload, '__dict__') else {}
        
        tools_obj = payload.get("tools") if isinstance(payload, dict) else None
        tools_data = []

        if isinstance(tools_obj, dict):
            tools_data = tools_obj.get("tools", [])
        elif isinstance(tools_obj, list):
            tools_data = tools_obj

        if isinstance(tools_data, list):
            for tool_dict in tools_data:
                if not isinstance(tool_dict, dict):
                    continue
                try:
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
                    for key in ("user_id", "access_token", "token", "creds", "account_email"):
                        if key in tool_dict and key not in params:
                            params[key] = tool_dict[key]

                    tool_spec = ToolSpec(
                        name=tool_dict.get("name", ""),
                        enabled=tool_dict.get("enabled", True),
                        params=params if isinstance(params, dict) else {},
                    )
                    self.tools_specs.append(tool_spec)
                    logger.debug("[RedisSession] Parsed tool: name=%s, enabled=%s, params_keys=%s", 
                                 tool_spec.name, tool_spec.enabled, list(params.keys()))
                except Exception as e:
                    logger.warning("[RedisSession] Failed to parse tool: %s", e)

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
        logger.info("[RedisSession] Parsed tools: count=%d, names=%s", len(self.tools_specs), tool_names)

    def _parse_history(self, payload: Any):
        if payload and isinstance(payload, dict):
            history_data = payload.get("history", [])
            if isinstance(history_data, list):
                for msg in history_data:
                    if isinstance(msg, dict):
                        self.chat_history.append({
                            "role": msg.get("role", "user"),
                            "content": msg.get("text") or msg.get("content", "")
                        })
                logger.info("[RedisSession] Parsed history: count=%d, first_role=%s, last_role=%s", 
                            len(self.chat_history), 
                            self.chat_history[0]["role"] if self.chat_history else "N/A",
                            self.chat_history[-1]["role"] if self.chat_history else "N/A")


    async def handle_user_message(self, frame: Frame):
        payload = frame.payload or {}
        text = payload.get("message", "")
        message_id = str(uuid.uuid4())
        
        # --- NEW LOGIC: Init from Payload ---
        
        # 1. Check and update chat history
        incoming_history = payload.get("history")
        if incoming_history:
            # Wrap in dict to match _parse_history expectation or change _parse_history
            # The Go side sends "History": [...] which arrives as payload["history"] = [...]
            # _parse_history expects {"history": [...]} or just the payload if it contains "history"
            self._parse_history(payload) 

        # 2. Check and update tools/commands
        if payload.get("tools") or payload.get("command") or payload.get("team"):
            self._parse_tools(payload)
            # If tools updated, we might need to assume agent needs rebuild (which happens below anyway)

        # ------------------------------------

        # Build agent
        await self.build_agent_instance(payload)
        
        # If we have history and the agent supports it, we might want to load it.
        # But commonly the Agent loads from DB based on session_id.
        # If we want to use the push-history, we might need to manually set it.
        # However, for now, we follow the user's request to just parse it.
        
        msg_chat_id = frame.chat_id or self.chat_id

        # Send Meta (Empty message bubble fix: Frontend filters it, but backend needs to reserve ID?)
        # Actually, Go backend already has the message ID from the user? 
        # No, this message_id is for the Response.
        # We still send it.
        await self._send_frame(make_meta(self.next_id, Op.MESSAGE, msg_chat_id, {"message_id": message_id}))

        start_action_tracking()

        idx = 0
        try:
            # We reuse the same streaming logic as WS.
            # BUT _stream_agent_events is defined in LLMWebSocketSession... we need to copy or share it.
            # Since it's complex, I should copy it here or refactor to a mixin.
            # For expediency, I will copy the logic but using self.agent
            
            async for event in self._stream_agent_events(text, payload.get("attachments")):
                 if self.cancel_event.is_set():
                    break
                 
                 evt_type = event.get("type")
                 
                 if evt_type == "text":
                    chunk = event.get("content", "")
                    if chunk:
                        await self._send_frame(make_data(self.next_id, Op.MESSAGE, msg_chat_id, {
                            "ix": idx,
                            "eof": False,
                            "message": chunk,
                            "message_id": message_id
                        }))
                        idx += 1
                        
                 elif evt_type == "tool_call":
                     # (Copy logic from WS)
                     safe_tool = event.get("tool", {}) # Simplified for brevity, need full logic?
                     # Full logic is better
                     tool_data = event.get("tool", {})
                     safe_tool = {
                        "name": getattr(tool_data, "tool_name", "unknown") if hasattr(tool_data, "tool_name") else tool_data.get("name", "unknown"),
                        "arguments": getattr(tool_data, "tool_args", {}) if hasattr(tool_data, "tool_args") else tool_data.get("arguments", {}),
                        "result": getattr(tool_data, "result", None) if hasattr(tool_data, "result") else tool_data.get("result", None)
                     }
                     
                     # Handle mock/legacy
                     if hasattr(tool_data, "name") and not isinstance(tool_data, dict):
                          safe_tool["name"] = tool_data.name
                          
                     # Handle suggest_actions
                     # ... (Omitting complex suggestion logic for MVP, can add if needed)
                     
                     await self._send_frame(make_data(self.next_id, Op.MESSAGE, msg_chat_id, {
                        "type": "tool_call",
                        "tool": safe_tool,
                        "message_id": message_id
                     }))
                     
                 elif evt_type == "reasoning":
                     content = event.get("content", "")
                     if content:
                         await self._send_frame(make_data(self.next_id, Op.MESSAGE, msg_chat_id, {
                             "type": "reasoning",
                             "content": content,
                             "message_id": message_id
                         }))

            # Done
            await self._send_frame(make_done(self.next_id, msg_chat_id, {"message_id": message_id}))

        except Exception as e:
            logger.error(f"[RedisSession] Error streaming: {e}", exc_info=True)
            await self._send_frame(make_error(self.next_id, "stream_failed", msg_chat_id, str(e), 500))

    async def _stream_agent_events(self, text: str, attachments: Optional[list]) -> Any:
        # Prepare inputs
        kwargs = {}
        # Only pass session_id for non-team mode
        if self.session_id and self.command_desc and self.command_desc.get("type", "agent") != "team":
             kwargs["session_id"] = self.session_id

        agent_input = text
        if self.chat_history:
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
                    agent_input = f"""[IMPORTANT: The following is your conversation history with this user. Use it to answer questions about previous messages.]

--- Previous messages in this conversation ---
{history_context}
--- End of conversation history ---

User's new message: {text}"""
                else:
                    agent_input = f"""[IMPORTANT: Continue the conversation based on history below.]

--- Previous messages ---
{history_context}
--- End ---

Continue the conversation."""
                
                logger.info("[RedisSession] Injected chat history: %d messages into prompt", len(self.chat_history))
            except Exception as e:
                logger.error("[RedisSession] Failed to inject history: %s", e)

        if attachments:
            images = []
            for att in attachments:
                if isinstance(att, dict) and att.get("file_type", "").startswith("image/"):
                    import base64
                    try:
                        content = att.get("content", "")
                        if content:
                            image_bytes = base64.b64decode(content)
                            if attrs := getattr(Image, "__annotations__", None):
                                # Agno Image check
                                images.append(Image(content=image_bytes, format=att.get("file_type")))
                            else:
                                logger.warning("[RedisSession] Unknown Image class structure, skipping")
                    except Exception as e:
                        logger.error("[RedisSession] Image decode error: %s", e)
            if images:
                kwargs["images"] = images

        agent = self.agent
        if not agent:
            raise ValueError("Agent not initialized")

        # Log what we're sending to the agent
        logger.info("[RedisSession] Calling agent with: text=%s, kwargs=%s", 
                    text[:50] if text else "None", kwargs.keys())

        # Helper to decide if we should await
        async def run_fn(fn):
            inp = agent_input
            if isinstance(inp, str):
                 inp = inp if (inp and inp.strip()) else "[continue from previous context]"
            
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
            logger.error("[RedisSession] Agent invocation failed: %s", e)
            raise

        if not result:
             logger.error("[RedisSession] No callable method found on agent")
             return

        # Iterate stream
        if hasattr(result, "__aiter__"):
            streamed_text_len = 0
            async for ev in result:
                event_type = type(ev).__name__
                logger.info(f"[RedisSession] Stream event received: {event_type}")
                logger.debug(f"[RedisSession] Event details: {ev}")
                
                # Check if this is a member agent event
                agent_id = getattr(ev, 'agent_id', None)
                agent_name = getattr(ev, 'agent_name', None) or agent_id
                is_member_event = agent_id is not None

                # 1. Tool Calls
                if "ToolCallCompleted" in event_type:
                    if hasattr(ev, 'tool') and ev.tool:
                        tool_data = {"type": "tool_call", "tool": ev.tool}
                        if is_member_event:
                            tool_data["agent_id"] = agent_id
                            tool_data["agent_name"] = agent_name
                        yield tool_data

                # 2. Reasoning
                captured_reasoning = None
                if hasattr(ev, 'reasoning_content') and ev.reasoning_content:
                    captured_reasoning = ev.reasoning_content
                elif hasattr(ev, 'thinking') and ev.thinking:
                     captured_reasoning = ev.thinking
                elif "Reasoning" in event_type and hasattr(ev, 'content'):
                     captured_reasoning = ev.content

                if captured_reasoning:
                    yield {"type": "reasoning", "content": captured_reasoning}

                if "RunCompleted" in event_type:
                    val = getattr(ev, "content", None)
                    if val and len(str(val)) > streamed_text_len:
                        remainder = str(val)[streamed_text_len:]
                        if remainder.strip():
                            logger.info("[RedisSession] Sending remaining content from RunCompleted: %s...", remainder[:50])
                            # Check if it looks like reasoning
                            if remainder.strip().startswith("My thinking process") or remainder.strip().startswith("Thinking Process:"):
                                yield {"type": "reasoning", "content": remainder}
                            else:
                                yield {"type": "text", "content": remainder}

                # 3. Text Content
                if "RunContentEvent" in event_type or "ModelContentEvent" in event_type or "TextDeltaEvent" in event_type or "TextEvent" in event_type:
                    val = None
                    if hasattr(ev, "content"): val = ev.content
                    elif hasattr(ev, "text"): val = ev.text
                    elif hasattr(ev, "delta"): val = ev.delta

                    chunk = str(val) if val is not None else ""
                    
                    if chunk:
                         # Skip tool outputs that shouldn't be shown to users
                         if (chunk.startswith("```tool_outputs") or 
                             chunk.startswith("{\"delegate_task_to_member") or 
                             "delegate_task_to_member_response" in chunk):
                             continue

                         if chunk != captured_reasoning:
                             if is_member_event:
                                 yield {"type": "member_response", "content": chunk, "agent_id": agent_id, "agent_name": agent_name}
                             else:
                                 yield {"type": "text", "content": chunk}
                                 streamed_text_len += len(chunk)

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
