import asyncio
import contextlib
import json
import logging
import time
import uuid
from typing import Optional, List, Any, AsyncGenerator, Dict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Cookie
from agno.agent import Agent
from agno.media import Image

from src.agents.factory import AgentFactory
from src.server.models import Frame, Op
from src.server.utils import make_meta, make_error, make_done, make_data
from src.teams import TeamFactory
from src.tools.models import ToolSpec

logger = logging.getLogger(__name__)

def _truncate(text: Optional[str], limit: int = 200) -> str:
    if text is None:
        return ""
    text = str(text)
    if len(text) <= limit:
        return text
    return f"{text[:limit]}...(truncated)"

def _classify_error(exc: Exception) -> tuple[int, str, str]:
    s = str(exc)
    if "429" in s or "RESOURCE_EXHAUSTED" in s or "Too Many Requests" in s:
        return 429, "rate_limited", "Too many requests. Try later."
    if "503" in s or "unavailable" in s.lower():
        return 503, "upstream_unavailable", "Service is temporally unavailable. Try later."
    if "timeout" in s.lower():
        return 504, "upstream_timeout", "Request timed out. Please try again."
    if "context_length_exceeded" in s:
        return 400, "context_length_exceeded", "Context length exceeded."
    return 500, "internal_error", f"Internal Server Error: {s}"

class LLMWebSocketSession:
    def __init__(self, websocket: WebSocket, session_id: str, agent_factory: AgentFactory):
        self.websocket = websocket
        self.session_id = session_id
        self.agent_factory = agent_factory
        self.next_id = 0
        self.cancel_event = asyncio.Event()

        # State
        self.agent: Optional[Agent] = None
        self.tools_specs: List[ToolSpec] = []
        self.chat_history: List[Dict[str, str]] = []
        self.current_model_name: Optional[str] = None
        self.current_web_search: bool = False
        self.current_thinking: str = "off"
        self.command_desc: Optional[dict] = None
        self.agent_type: Optional[str] = None
        self.build_mode: str = "agent"
        self.chat_id_param: Optional[str] = None

        # Pending frame from handshake
        self.pending_frame: Optional[Frame] = None

    async def _send_frame(self, frame: Frame) -> int:
        data = frame.marshal()
        logger.debug("[WS] Sending frame: op=%s id=%d payload_len=%d", frame.op, frame.id, len(str(data.get("payload", ""))))
        try:
            await self.websocket.send_json(data)
        except RuntimeError as e:
            logger.debug("[WS] Cannot send frame (WebSocket closed): %s", e)
        self.next_id = frame.id + 1
        return self.next_id

    async def _send_error(self, e: Exception, chat_id: Optional[str]) -> int:
        http_status, status_text, user_msg = _classify_error(e)
        logger.error("[WS] Agent failed: sessionId=%s status=%s detail=%s", self.session_id, status_text, e)
        return await self._send_frame(
            make_error(
                id=self.next_id,
                chat_id=chat_id,
                code=status_text,
                message=user_msg,
                http=http_status,
            )
        )

    async def accept(self):
        await self.websocket.accept()

        # Parse query params
        qp = self.websocket.query_params
        self.current_model_name = qp.get("model")
        self.agent_type = qp.get("agent")
        self.build_mode = (qp.get("mode") or "agent").lower()
        self.chat_id_param = qp.get("chat_id")
        
        raw_cmd = qp.get("command") or qp.get("team") or qp.get("team_desc")
        if raw_cmd:
            try:
                self.command_desc = json.loads(raw_cmd)
            except Exception:
                logger.warning("[WS] Failed to parse json param: session_id=%s value=%s", self.session_id, raw_cmd)

        logger.info("[WS] Open: session_id=%s mode=%s model=%s", self.session_id, self.build_mode, self.current_model_name)

    async def initialize(self):
        """Handle handshake: TOOLS and HISTORY."""
        # 1. Wait for TOOLS
        logger.info("[WS] Waiting for TOOLS frame: session_id=%s", self.session_id)
        try:
            raw = await asyncio.wait_for(self.websocket.receive_text(), timeout=15.0)
            data = json.loads(raw)
            frame = Frame(**data)
            
            if frame.op == Op.TOOLS:
                self._parse_tools(frame.payload)
            else:
                logger.warning("[WS] Expected TOOLS frame but got: %s", frame.op)
        except asyncio.TimeoutError:
            logger.warning("[WS] Timeout waiting for tools: session_id=%s", self.session_id)
        except WebSocketDisconnect:
            raise
        except Exception as e:
            logger.warning("[WS] Failed to receive tools: %s", e)

        # 2. Wait for HISTORY (optional)
        try:
            raw = await asyncio.wait_for(self.websocket.receive_text(), timeout=2.0)
            data = json.loads(raw)
            frame = Frame(**data)
            
            if frame.op == Op.HISTORY:
                self._parse_history(frame.payload)
            else:
                # Save for main loop
                logger.debug("[WS] Got %s instead of HISTORY, saving.", frame.op)
                self.pending_frame = frame
        except asyncio.TimeoutError:
            logger.debug("[WS] Timeout waiting for history")
        except WebSocketDisconnect:
            raise
        except Exception as e:
            logger.warning("[WS] Failed to receive history: %s", e)

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
                    params = tool_dict.get("params", {})
                    if isinstance(params, str):
                        try:
                            params = json.loads(params)
                        except json.JSONDecodeError:
                            params = {}

                    tool_spec = ToolSpec(
                        name=tool_dict.get("name", ""),
                        enabled=tool_dict.get("enabled", True),
                        params=params if isinstance(params, dict) else {},
                    )
                    self.tools_specs.append(tool_spec)
                except Exception as e:
                    logger.warning("[WS] Failed to parse tool: %s", e)

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

        logger.info("[WS] Parsed tools: count=%d", len(self.tools_specs))

    def _parse_history(self, payload: Any):
        if payload and isinstance(payload, dict):
            history_data = payload.get("history", [])
            if isinstance(history_data, list):
                for msg in history_data:
                    if isinstance(msg, dict):
                        self.chat_history.append({
                            "role": msg.get("role", "user"),
                            "content": msg.get("text", "")
                        })
                logger.info("[WS] Parsed history: count=%d", len(self.chat_history))

    async def build_agent_instance(self):
        """Build or rebuild the agent."""
        try:
            if self.build_mode == "team":
                if not self.command_desc:
                    raise ValueError("Team mode requires command description")

                team_factory = TeamFactory(
                    agent_factory=self.agent_factory,
                    db=self.agent_factory._db,
                    model=self.agent_factory.build_model(self.current_model_name) if self.current_model_name else self.agent_factory._model,
                    debug_mode=self.agent_factory._debug_mode,
                )
                self.agent = await team_factory.build(
                    command_desc=self.command_desc,
                    session_id=self.session_id,
                )
            else:
                self.agent = await self.agent_factory.build(
                    self.session_id,
                    tools_specs=self.tools_specs,
                    model_name=self.current_model_name,
                    agent_type=self.agent_type,
                    command_desc=self.command_desc,
                    web_search=self.current_web_search,
                    thinking=self.current_thinking,
                    user_id=self.session_id,
                    chat_id=self.chat_id_param,
                )
            logger.info("[WS] Agent built successfully")
        except Exception as e:
            logger.error("[WS] Failed to build agent: %s", e)
            raise

    async def run_loop(self):
        """Main event loop."""
        last_activity = time.monotonic()

        # Initial build
        try:
            await self.build_agent_instance()
        except Exception as e:
            await self._send_frame(make_error(self.next_id, "agent_init_failed", None, str(e), 500))
            await self.websocket.close(code=1011)
            return

        while True:
            # Check pending first
            if self.pending_frame:
                frame = self.pending_frame
                self.pending_frame = None
                await self.process_frame(frame)
                continue

            # Wait for next frame
            try:
                raw = await asyncio.wait_for(self.websocket.receive_text(), timeout=30.0)
                last_activity = time.monotonic()
                try:
                    data = json.loads(raw)
                    frame = Frame(**data)
                    frame.validate_invariants()
                    await self.process_frame(frame)
                except Exception as ex:
                    logger.warning("[WS] Bad frame: %s", ex)
                    await self._send_frame(make_error(self.next_id, None, "bad_request", "Invalid frame", 400))
            except asyncio.TimeoutError:
                idle_for = time.monotonic() - last_activity
                if idle_for >= 180:
                    logger.info("[WS] Idle timeout")
                    await self._send_frame(make_done(self.next_id, None, {"reason": "idle_timeout"}))
                    await self.websocket.close(code=1000)
                    break
                # Keepalive
                await self._send_frame(make_data(self.next_id, Op.PING, None, {}))
            except WebSocketDisconnect:
                logger.info("[WS] Disconnected")
                break
            except Exception as e:
                logger.error("[WS] Unexpected error in loop: %s", e)
                break

    async def process_frame(self, frame: Frame):
        if frame.op == Op.PING:
            await self._send_frame(make_data(self.next_id, Op.PONG, frame.chat_id, {}))
            
        elif frame.op == Op.STOP:
            self.cancel_event.set()
            await self._send_frame(make_done(self.next_id, frame.chat_id, {"message": "stopped", "reason": "user_cancelled"}))
            self.cancel_event.clear()
            
        elif frame.op == Op.DONE:
            await self._send_frame(make_data(self.next_id, Op.DONE, frame.chat_id, {"message": "bye"}))
            await self.websocket.close(code=1000)
            raise WebSocketDisconnect() # Break loop
            
        elif frame.op == Op.MODEL:
            await self.handle_model_change(frame)
            
        elif frame.op == Op.MESSAGE:
            await self.handle_user_message(frame)
            
        else:
            logger.warning("[WS] Unexpected op: %s", frame.op)

    async def handle_model_change(self, frame: Frame):
        payload = frame.payload or {}
        new_model = payload.get("model")
        if not new_model:
            await self._send_frame(make_error(self.next_id, "bad_request", frame.chat_id, "Missing model name", 400))
            return

        logger.info("[WS] Changing model to %s", new_model)
        self.current_model_name = new_model

        # If team mode, update command_desc
        if self.build_mode == "team" and self.command_desc:
            self.command_desc["model"] = new_model
            
        try:
            await self.build_agent_instance()
            await self._send_frame(make_data(self.next_id, Op.ACK, frame.chat_id, {"model": new_model}))
        except Exception as e:
            await self._send_frame(make_error(self.next_id, "model_change_failed", frame.chat_id, str(e), 500))

    async def handle_user_message(self, frame: Frame):
        payload = frame.payload or {}
        text = payload.get("message", "")
        message_id = str(uuid.uuid4())
        chat_id = frame.chat_id

        # Validate that we have actual content
        if not text or not text.strip():
            logger.warning("[WS] Received empty message, ignoring to prevent Gemini 400 error")
            return

        # Check settings changes in payload
        msg_model = payload.get("model")
        if msg_model and msg_model != self.current_model_name:
            self.current_model_name = msg_model
            await self.build_agent_instance()

        req_thinking = payload.get("thinking")
        if req_thinking is not None:
             new_thinking = "off"
             if isinstance(req_thinking, bool):
                 new_thinking = "medium" if req_thinking else "off"
             elif isinstance(req_thinking, str):
                 new_thinking = req_thinking.lower()

             if new_thinking != self.current_thinking:
                 self.current_thinking = new_thinking
                 await self.build_agent_instance()

        attachments = payload.get("attachments")

        # Start message
        await self._send_frame(make_meta(self.next_id, Op.MESSAGE, chat_id, {"message_id": message_id}))

        start_time = time.monotonic()
        idx = 0
        tokens_len = 0

        try:
            async for event in self._stream_agent_events(text, attachments):
                if self.cancel_event.is_set():
                    break

                evt_type = event.get("type")

                if evt_type == "text":
                    chunk = event.get("content", "")
                    if chunk:
                        tokens_len += len(chunk)
                        await self._send_frame(make_data(self.next_id, Op.MESSAGE, chat_id, {
                            "ix": idx,
                            "eof": False,
                            "message": chunk,
                            "message_id": message_id
                        }))
                        idx += 1

                elif evt_type == "tool_call":
                    # Send tool call immediately
                    tool_data = event.get("tool", {})
                    
                    # Debug logging to find where result is stored
                    logger.info("[WS] Tool call event. tool_data type: %s", type(tool_data))
                    if hasattr(tool_data, '__dict__'):
                        logger.info("[WS] tool_data attrs: %s", list(tool_data.__dict__.keys()))
                    logger.info("[WS] event type: %s, has result: %s", type(event), event.get('result') is not None)
                    if event.get('result'):
                        logger.info("[WS] event.result: %s", str(event.get('result'))[:200])
                    
                    # Map to serializable format
                    safe_tool = {
                        "name": getattr(tool_data, "tool_name", "unknown") if hasattr(tool_data, "tool_name") else tool_data.get("name", "unknown"),
                        "arguments": getattr(tool_data, "tool_args", {}) if hasattr(tool_data, "tool_args") else tool_data.get("arguments", {}),
                        # Include result if available (for ToolCallCompleted)
                        "result": getattr(tool_data, "result", None) if hasattr(tool_data, "result") else tool_data.get("result", None)
                    }

                    # Handle legacy or mock objects
                    if hasattr(tool_data, "name") and not isinstance(tool_data, dict):
                         safe_tool["name"] = tool_data.name

                    logger.info("[WS] Streaming tool call: %s", safe_tool["name"])
                    
                    # Check if tool result contains action buttons (from suggest_actions)
                    result = safe_tool.get("result")
                    # Try additional sources if result not in safe_tool
                    if result is None and hasattr(ev, 'tool') and hasattr(ev.tool, 'result'):
                        result = ev.tool.result
                    if result is None and hasattr(ev, 'result'):
                        result = ev.result
                    
                    if result:
                        try:
                            # Parse result - could be string or already dict
                            if isinstance(result, str):
                                result_data = json.loads(result)
                            elif isinstance(result, dict):
                                result_data = result
                            else:
                                result_data = None
                            
                            if result_data and result_data.get("__action_buttons__"):
                                actions_list = result_data.get("actions", [])
                                logger.info("[WS] Sending action buttons from suggest_actions: %s", actions_list)
                                logger.info("[WS] Full result_data: %s", result_data)
                                # Send action buttons as a special frame
                                await self._send_frame(make_data(self.next_id, Op.MESSAGE, chat_id, {
                                    "type": "actions",
                                    "actions": actions_list,
                                    "message_id": message_id
                                }))
                                # Don't send regular tool call frame for action buttons
                                continue
                        except (json.JSONDecodeError, TypeError):
                            pass
                    
                    await self._send_frame(make_data(self.next_id, Op.MESSAGE, chat_id, {
                        "type": "tool_call",
                        "tool": safe_tool,
                        "message_id": message_id
                    }))

                elif evt_type == "reasoning":
                    content = event.get("content", "")
                    await self._send_frame(make_meta(self.next_id, Op.MESSAGE, chat_id, {
                        "type": "metadata",
                        "reasoning_steps": [content],
                        "message_id": message_id
                    }))

                elif evt_type == "member_response":
                    # Team member agent response - send as system activity
                    chunk = event.get("content", "")
                    agent_name = event.get("agent_name", "Member")
                    if chunk:
                        await self._send_frame(make_data(self.next_id, Op.MESSAGE, chat_id, {
                            "type": "member_response",
                            "agent_name": agent_name,
                            "message": chunk,
                            "message_id": message_id
                        }))

        except Exception as e:
            await self._send_error(e, chat_id)
            return

        # EOF
        await self._send_frame(make_data(self.next_id, Op.MESSAGE, chat_id, {
            "ix": idx,
            "eof": True,
            "message": "",
            "message_id": message_id
        }))

        # Usage
        elapsed = int((time.monotonic() - start_time) * 1000)
        await self._send_frame(make_meta(self.next_id, Op.MESSAGE, chat_id, {
            "type": "usage",
            "prompt_tokens": len(text) // 4,
            "completion_tokens": tokens_len // 4,
            "elapsed_ms": elapsed,
            "message_id": message_id
        }))

        # Final model info (optional, helpful for UI)
        if self.current_model_name:
             await self._send_frame(make_meta(self.next_id, Op.MESSAGE, chat_id, {
                "type": "metadata",
                "model": self.current_model_name,
                "message_id": message_id
            }))

        await self._send_frame(make_done(self.next_id, chat_id, {"message_id": message_id, "reason": "stop"}))


    async def _stream_agent_events(self, text: str, attachments: Optional[list]) -> AsyncGenerator[Dict[str, Any], None]:
        """Generator that yields structured events from the agent."""
        
        # Prepare inputs
        kwargs = {}
        if self.session_id:
            kwargs["session_id"] = self.session_id
            
        if attachments:
            images = []
            for att in attachments:
                if isinstance(att, dict) and att.get("file_type", "").startswith("image/"):
                    import base64
                    try:
                        content = att.get("content", "")
                        if content:
                            image_bytes = base64.b64decode(content)
                            images.append(Image(content=image_bytes, format=att.get("file_type")))
                    except Exception as e:
                        logger.error("[WS] Image decode error: %s", e)
            if images:
                kwargs["images"] = images

        # Add current message to history?
        # Agno handles history via session_id, so we just pass text.

        # Invoke agent
        agent = self.agent
        if not agent:
            raise ValueError("Agent not initialized")

        # Try async stream
        result = None
        
        # Helper to decide if we should await
        async def run_fn(fn):
            if asyncio.iscoroutinefunction(fn):
                return await fn(text, stream=True, stream_events=True, **kwargs)
            return fn(text, stream=True, stream_events=True, **kwargs)

        try:
            if hasattr(agent, "arun"):
                result = await run_fn(agent.arun)
            elif hasattr(agent, "run"):
                result = await run_fn(agent.run)
            else:
                 # Fallback to generate/respond
                 for m in ("generate", "respond", "chat"):
                    fn = getattr(agent, m, None)
                    if fn:
                        result = await run_fn(fn)
                        break
        except Exception as e:
            logger.error("[WS] Agent invocation failed: %s", e)
            raise

        if not result:
             logger.error("[WS] No callable method found on agent")
             return

        # Iterate stream
        if hasattr(result, "__aiter__"):
            async for ev in result:
                event_type = type(ev).__name__
                # logger.debug("[WS] Event: %s", event_type)

                # Check if this is a member agent event (not the leader)
                agent_id = getattr(ev, 'agent_id', None)
                agent_name = getattr(ev, 'agent_name', None) or agent_id
                is_member_event = agent_id is not None

                # 1. Tool Calls
                # Agno emits ToolCallCompletedEvent with 'tool' attribute
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
                # Gemini parts check... omitted for brevity unless needed, relying on Agno abstraction
                elif "Reasoning" in event_type and hasattr(ev, 'content'):
                     captured_reasoning = ev.content

                if captured_reasoning:
                    yield {"type": "reasoning", "content": captured_reasoning}

                # 3. Text Content
                # Only yield text if it's a content event
                # Be careful not to yield reasoning again if it came as content
                if "RunContentEvent" in event_type or "ModelContentEvent" in event_type or "TextDeltaEvent" in event_type or "TextEvent" in event_type: # Added TextEvent for mock

                    val = None
                    if hasattr(ev, "content"): val = ev.content
                    elif hasattr(ev, "text"): val = ev.text
                    elif hasattr(ev, "delta"): val = ev.delta

                    chunk = str(val) if val is not None else ""
                    if chunk and chunk != captured_reasoning:
                         # Mark member responses differently
                         if is_member_event:
                             yield {"type": "member_response", "content": chunk, "agent_id": agent_id, "agent_name": agent_name}
                         else:
                             yield {"type": "text", "content": chunk}

        elif hasattr(result, "__iter__") and not isinstance(result, (str, bytes)):
             # Sync iterator
             for ev in result:
                 # Logic same as above, but synchronous
                 # For now, assume async agent mostly.
                 pass

        else:
             # Single value fallback
             chunk = str(result)
             if chunk:
                 yield {"type": "text", "content": chunk}

def router(agent_factory: AgentFactory) -> APIRouter:
    r = APIRouter()

    @r.websocket("/llm/ws")
    async def llm_ws(
        websocket: WebSocket,
        session_id: Optional[str] = Cookie(None),
    ):
        if session_id is None:
            await websocket.accept()
            await websocket.close(code=1008, reason="invalid session_id")
            return

        session = LLMWebSocketSession(websocket, session_id, agent_factory)

        try:
            await session.accept()
            await session.initialize()
            await session.run_loop()
        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.exception("[WS] Unhandled error in session %s", session_id)
            if session.websocket.client_state.name == "CONNECTED":
                 await session.websocket.close(code=1011)

    return r
