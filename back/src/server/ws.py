import asyncio
import contextlib
import json
import logging
import time
import uuid

from agno.agent import Agent
from typing import Optional, Tuple, List
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Cookie

from src.agents.factory import AgentFactory
from src.server.models import Frame, Op
from src.server.utils import make_meta, make_error, make_done, make_data
from src.teams import TeamFactory
from src.tools.config import ToolConfigClient
from src.tools.models import ToolSpec
# from agno.tools.duckduckgo import DuckDuckGoTools
from src.tools.duckduckgo_custom import DuckDuckGoTools
from agno.tools.mcp import MCPTools

logger = logging.getLogger(__name__)


def _truncate(text: Optional[str], limit: int = 200) -> str:
    if text is None:
        return ""
    text = str(text)
    if len(text) <= limit:
        return text
    return f"{text[:limit]}...(truncated)"


def router(agent_factory: AgentFactory) -> APIRouter:
    r = APIRouter()

    @r.websocket("/llm/ws")
    async def llm_ws(
        websocket: WebSocket,
        # chat_id: Optional[str] = Query(None),
        session_id: Optional[str] = Cookie(None),
    ):
        # if chat_id is None:
        #     await websocket.accept()
        #     await websocket.close(code=1008, reason=f"invalid chat_id: {chat_id}")
        #     logger.warning("[WS] Reject: missing chat_id")
        #     return

        if session_id is None:
            await websocket.accept()
            await websocket.close(code=1008, reason=f"invalid session_id: {session_id}")
            logger.warning("[WS] Reject: missing session_id")
            logger.info("[WS] Open: session_id=%s", session_id)
            return

        await websocket.accept()
        
        def _parse_json_param(raw: Optional[str]) -> Optional[dict]:
            if not raw:
                return None
            try:
                return json.loads(raw)
            except Exception:
                logger.warning("[WS] Failed to parse json param: session_id=%s value=%s", session_id, raw)
                return None

        # Extract model from query parameters if provided
        model_from_query = websocket.query_params.get("model")
        agent_type = websocket.query_params.get("agent")
        build_mode = (websocket.query_params.get("mode") or "agent").lower()
        is_team_mode = build_mode == "team"
        chat_id_param = websocket.query_params.get("chat_id")
        command_desc: Optional[dict] = _parse_json_param(
            websocket.query_params.get("command") or websocket.query_params.get("team") or websocket.query_params.get("team_desc")
        )
        
        if model_from_query or agent_type:
            logger.info("[WS] Open: session_id=%s model=%s agent=%s mode=%s", session_id, model_from_query, agent_type, build_mode)
        else:
            logger.info("[WS] Open: session_id=%s mode=%s", session_id, build_mode)
        logger.debug(
            "[WS] Query params: session_id=%s chat_id=%s model=%s agent=%s mode=%s",
            session_id,
            chat_id_param,
            model_from_query,
            agent_type,
            build_mode,
        )

        next_id = 0
        cancel_event = asyncio.Event()  # For graceful stop
        
        # Ждем инструменты от genie-api при подключении (genie-api отправляет их автоматически)
        tools_specs: List[ToolSpec] = []
        # Track current model - initialize from query param if provided
        current_model_name: Optional[str] = model_from_query
        # Track current web_search state for agent rebuild
        current_web_search: bool = False
        # Track current thinking mode state for agent rebuild
        current_thinking: str = "off"
        
        logger.info("[WS] Waiting for TOOLS frame: session_id=%s", session_id)
        try:
            # Ждем первый фрейм с инструментами (15 сек таймаут для медленных DB запросов)
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=15.0)
            logger.info("[WS] Received raw data (TOOLS wait): session_id=%s len=%d", session_id, len(raw))
            data = json.loads(raw)
            frame = Frame(**data)
            logger.info("[WS] Parsed frame (TOOLS wait): session_id=%s op=%s", session_id, frame.op)
            
            if frame.op == Op.TOOLS:
                # Получили инструменты от genie-api
                payload = frame.payload
                logger.info("[WS] Received TOOLS frame: session_id=%s payload_type=%s", session_id, type(payload).__name__)
                logger.debug("[WS] Tools payload raw: session_id=%s payload=%s", session_id, payload)
                if payload:
                    if not isinstance(payload, dict):
                        payload = payload if hasattr(payload, '__dict__') else {}
                    
                    tools_obj = payload.get("tools") if isinstance(payload, dict) else None
                    logger.info("[WS] tools_obj: type=%s value=%s", type(tools_obj).__name__ if tools_obj else "None", str(tools_obj)[:200] if tools_obj else "None")
                    if tools_obj:
                        if isinstance(tools_obj, dict):
                            tools_data = tools_obj.get("tools", [])
                            logger.info("[WS] tools_obj is dict, extracted tools_data: count=%d", len(tools_data) if isinstance(tools_data, list) else 0)
                        elif isinstance(tools_obj, list):
                            tools_data = tools_obj
                            logger.info("[WS] tools_obj is list: count=%d", len(tools_data))
                        else:
                            tools_data = []
                            logger.warning("[WS] tools_obj is unexpected type: %s", type(tools_obj).__name__)
                        
                        if isinstance(tools_data, list):
                            for tool_dict in tools_data:
                                if not isinstance(tool_dict, dict):
                                    logger.debug("[WS] tool not appended: not dict")
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
                                    tools_specs.append(tool_spec)
                                    logger.debug("[WS] tool appended: name=%s", tool_spec.name)
                                except Exception as e:
                                    logger.warning(
                                        "[WS] Failed to parse tool: session_id=%s error=%s tool=%s",
                                        session_id,
                                        e,
                                        tool_dict,
                                    )
                                    continue
                    
                    # Опционально принимаем описание команды/агента из payload
                    cmd_obj = payload.get("command") if isinstance(payload, dict) else None
                    if cmd_obj is None and isinstance(payload, dict):
                        cmd_obj = payload.get("team")

                    if cmd_obj:
                        if isinstance(cmd_obj, str):
                            try:
                                cmd_obj = json.loads(cmd_obj)
                            except json.JSONDecodeError:
                                logger.warning("[WS] Failed to parse command payload: session_id=%s", session_id)
                                cmd_obj = None
                        if isinstance(cmd_obj, dict):
                            command_desc = cmd_obj
                
                tool_names = [t.name for t in tools_specs]
                logger.info(
                    "[WS] Received tools: session_id=%s count=%d names=%s",
                    session_id,
                    len(tools_specs),
                    tool_names,
                )
                logger.debug("[WS] Tools details: session_id=%s specs=%s", session_id, tools_specs)
            else:
                logger.warning(
                    "[WS] Expected TOOLS frame but got: session_id=%s op=%s",
                    session_id,
                    frame.op,
                )
        except asyncio.TimeoutError:
            logger.warning(
                "[WS] Timeout waiting for tools: session_id=%s",
                session_id,
            )
            # Продолжаем без инструментов
        except WebSocketDisconnect:
            logger.info("[WS] Client disconnected (waiting for tools): session_id=%s", session_id)
            return
        except Exception as exc:
            logger.warning(
                "[WS] Failed to receive tools: session_id=%s error=%s",
                session_id,
                exc,
            )
            # Продолжаем без инструментов
        
        # Ожидаем HISTORY фрейм (опционально)
        chat_history = []
        pending_frame: Optional[Frame] = None  # Store any non-HISTORY frame for processing later
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=2.0)
            logger.debug("[WS] Received raw data (HISTORY wait): session_id=%s len=%d", session_id, len(raw))
            data = json.loads(raw)
            frame = Frame(**data)
            logger.debug("[WS] Parsed frame (HISTORY wait): session_id=%s op=%s", session_id, frame.op)
            
            if frame.op == Op.HISTORY:
                payload = frame.payload
                logger.debug("[WS] History payload raw: session_id=%s payload=%s", session_id, payload)
                if payload and isinstance(payload, dict):
                    history_data = payload.get("history", [])
                    if isinstance(history_data, list):
                        for msg in history_data:
                            if isinstance(msg, dict):
                                chat_history.append({
                                    "role": msg.get("role", "user"),
                                    "content": msg.get("text", "")
                                })
                        logger.info(
                            "[WS] Received chat history: session_id=%s count=%d",
                            session_id,
                            len(chat_history),
                        )
            else:
                # Не HISTORY фрейм - сохраняем для обработки в основном цикле
                logger.debug(
                    "[WS] No HISTORY frame received (got %s instead), saving for processing: session_id=%s",
                    frame.op,
                    session_id,
                )
                pending_frame = frame
        except asyncio.TimeoutError:
            # Таймаут - история не была отправлена, это нормально
            logger.debug(
                "[WS] No HISTORY frame received (timeout), continuing without history: session_id=%s",
                session_id,
            )
        except WebSocketDisconnect:
            logger.info("[WS] Client disconnected (waiting for history): session_id=%s", session_id)
            return
        except Exception as exc:
            logger.warning(
                "[WS] Failed to receive history: session_id=%s error=%s",
                session_id,
                exc,
            )
        
        # Опционально ждем MODEL фрейм для выбора модели - УБРАНО по запросу
        # Используем модель из query param или по умолчанию
        if current_model_name:
            logger.debug(
                "[WS] Using model from query param: session_id=%s model=%s",
                session_id,
                current_model_name,
            )
        else:
            if command_desc and isinstance(command_desc, dict) and command_desc.get("model"):
                current_model_name = command_desc.get("model")
            logger.debug(
                "[WS] Using default model: session_id=%s",
                session_id,
            )

        team_factory: Optional[TeamFactory] = None

        try:
            if is_team_mode:
                team_factory = TeamFactory(
                    agent_factory=agent_factory,
                    db=agent_factory._db,
                    model=agent_factory.build_model(current_model_name) if current_model_name else agent_factory._model,
                    debug_mode=agent_factory._debug_mode,
                )
                if not command_desc:
                    next_id = await _send_frame(
                        websocket=websocket,
                        frame=make_error(
                            id=next_id,
                            chat_id=None,
                            code="team_desc_missing",
                            message="Team mode requires command description.",
                            http=400,
                        ),
                    )
                    await websocket.close(code=1008, reason="Missing team description")
                    return

                agent = await team_factory.build(
                    command_desc=command_desc,
                    session_id=session_id,
                )
            else:
                # Создаем агента с полученными инструментами и моделью
                agent = await agent_factory.build(
                    session_id, 
                    tools_specs=tools_specs,
                    model_name=current_model_name,
                    agent_type=agent_type,
                    command_desc=command_desc,
                    web_search=current_web_search,
                    user_id=session_id,
                    chat_id=chat_id_param,
                )
        except Exception as exc:
            next_id = await _send_frame(
                websocket=websocket,
                frame=make_error(
                    id=next_id,
                    chat_id=None,
                    code="agent_init_failed",
                    message="Unable to build agent tooling.",
                    http=500,
                    details={"error": str(exc)},
                ),
            )
            with contextlib.suppress(Exception):
                await websocket.close(code=1011, reason="Agent init failed")
            logger.exception("[WS] Agent init failed: session_id=%s", session_id)
            return

        # Track last time we received any client message
        last_activity = time.monotonic()
        logger.debug("[WS] Entering main loop: session_id=%s", session_id)
        try:
            # Пример: таймауты чтения (idle close)
            while True:
                # Check if we have a pending frame from HISTORY wait phase
                if pending_frame is not None:
                    frame = pending_frame
                    pending_frame = None  # Clear it so we don't process it again
                    logger.debug("[WS] Processing pending frame: session_id=%s op=%s", session_id, frame.op)
                else:
                    try:
                        raw = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                        # Any received frame counts as activity
                        last_activity = time.monotonic()
                        logger.debug("[WS] Received raw data (Main loop): session_id=%s len=%d", session_id, len(raw))
                        try:
                            data = json.loads(raw)
                            frame = Frame(**data)
                            logger.debug("[WS] Parsed frame (Main loop): session_id=%s op=%s", session_id, frame.op)
                            # basic invariant checks; report as bad_request on failure
                            frame.validate_invariants()
                        except Exception as ex:
                            # Некорректный входящий фрейм — сообщаем клиенту и продолжаем
                            logger.warning(
                                "[WS] Bad frame: session_id=%s err=%s raw_len=%d",
                                session_id,
                                ex,
                                len(raw or ""),
                            )
                            next_id = await _send_frame(
                                websocket=websocket,
                                frame=make_error(
                                    id=next_id,
                                    code="bad_request",
                                    chat_id=None,
                                    message="Invalid frame payload",
                                    http=400,
                                ),
                            )
                            continue
                    except asyncio.TimeoutError:
                        # No incoming messages within read timeout window
                        idle_for = time.monotonic() - last_activity
                        if idle_for >= 180:
                            # Close idle connection after 3 minutes without client messages
                            logger.info(
                                "[WS] Idle timeout: closing session_id=%s idle_for=%.1fs",
                                session_id,
                                idle_for,
                            )
                            try:
                                next_id = await _send_frame(
                                    websocket=websocket,
                                    frame=make_done(
                                        id=next_id,
                                        chat_id=None,
                                        payload={
                                            "message": "done",
                                            "reason": "idle_timeout",
                                        },
                                    ),
                                )
                            finally:
                                with contextlib.suppress(Exception):
                                    await websocket.close(code=1000, reason="idle timeout")
                            break
                        # Otherwise send keepalive ping
                        logger.debug("[WS] Keepalive ping: session_id=%s", session_id)
                        next_id = await _send_frame(
                            websocket=websocket,
                            frame=make_data(
                                id=next_id,
                                op=Op.PING,
                                chat_id=None,
                                payload={},
                            ),
                        )
                        continue

                if frame.op == Op.PING:
                    logger.debug("[WS] Received ping: session_id=%s", session_id)
                    next_id = await _send_frame(
                        websocket=websocket,
                        frame=make_data(
                            id=next_id,
                            chat_id=frame.chat_id,
                            op=Op.PONG,
                            payload={},
                        ),
                    )
                    continue
                elif frame.op == Op.STOP:
                    logger.info("[WS] Client requested stop generation: session_id=%s", session_id)
                    cancel_event.set()
                    next_id = await _send_frame(
                        websocket=websocket,
                        frame=make_done(
                            id=next_id,
                            chat_id=frame.chat_id,
                            payload={
                                "message": "stopped",
                                "reason": "user_cancelled"
                            },
                        ),
                    )
                    # Reset for next message
                    cancel_event.clear()
                    continue
                elif frame.op == Op.DONE:
                    logger.info("[WS] Client requested close: session_id=%s", session_id)
                    await _send_frame(
                        websocket=websocket,
                        frame=make_data(
                            id=next_id,
                            op=Op.DONE,
                            chat_id=frame.chat_id,
                            payload={
                                "message": "done",
                                "reason": "Client says bye"
                            },
                        ),
                    )
                    await websocket.close(code=1000, reason="Client says bye")
                    break
                elif frame.op == Op.MODEL:
                    # Handle model change request
                    payload = frame.payload
                    if payload and isinstance(payload, dict):
                        new_model_name = payload.get("model")
                        if new_model_name:
                            try:
                                if is_team_mode:
                                    if not command_desc:
                                        logger.warning("[WS] Team mode missing command_desc on model change: session_id=%s", session_id)
                                        next_id = await _send_frame(
                                            websocket=websocket,
                                            frame=make_error(
                                                id=next_id,
                                                chat_id=frame.chat_id,
                                                code="team_desc_missing",
                                                message="Team mode requires command description.",
                                                http=400,
                                            ),
                                        )
                                        continue

                                    updated_desc = dict(command_desc)
                                    updated_desc["model"] = new_model_name
                                    team_factory = TeamFactory(
                                        agent_factory=agent_factory,
                                        db=agent_factory._db,
                                        model=agent_factory.build_model(new_model_name),
                                        debug_mode=agent_factory._debug_mode,
                                    )
                                    agent = await team_factory.build(
                                        command_desc=updated_desc,
                                        session_id=session_id,
                                    )
                                    command_desc = updated_desc
                                else:
                                    # Rebuild agent with new model
                                    logger.info(
                                        "[WS] Rebuilding agent with model change: session_id=%s new_model=%s tools_count=%d",
                                        session_id,
                                        new_model_name,
                                        len(tools_specs) if tools_specs else 0,
                                    )
                                    agent = await agent_factory.build(
                                        session_id,
                                        tools_specs=tools_specs,
                                        model_name=new_model_name,
                                        web_search=current_web_search,
                                        thinking=current_thinking,
                                        user_id=session_id,
                                        chat_id=chat_id_param,
                                    )
                                current_model_name = new_model_name
                                logger.info(
                                    "[WS] Model changed: session_id=%s new_model=%s mode=%s",
                                    session_id,
                                    new_model_name,
                                    build_mode,
                                )
                                # Send ACK
                                next_id = await _send_frame(
                                    websocket=websocket,
                                    frame=make_data(
                                        id=next_id,
                                        op=Op.ACK,
                                        chat_id=frame.chat_id,
                                        payload={"model": new_model_name}
                                    ),
                                )
                            except ValueError as e:
                                # Invalid model name
                                logger.warning(
                                    "[WS] Invalid model requested: session_id=%s model=%s error=%s",
                                    session_id,
                                    new_model_name,
                                    e,
                                )
                                next_id = await _send_frame(
                                    websocket=websocket,
                                    frame=make_error(
                                        id=next_id,
                                        chat_id=frame.chat_id,
                                        code="invalid_model",
                                        message=f"Unsupported model: {new_model_name}",
                                        http=400,
                                    ),
                                )
                            except Exception as e:
                                # Other errors during agent rebuild
                                logger.error(
                                    "[WS] Failed to change model: session_id=%s model=%s error=%s",
                                    session_id,
                                    new_model_name,
                                    e,
                                )
                                next_id = await _send_frame(
                                    websocket=websocket,
                                    frame=make_error(
                                        id=next_id,
                                        chat_id=frame.chat_id,
                                        code="model_change_failed",
                                        message="Failed to change model",
                                        http=500,
                                        details={"error": str(e)},
                                    ),
                                )
                        else:
                            logger.warning(
                                "[WS] MODEL frame without model name: session_id=%s",
                                session_id,
                            )
                            next_id = await _send_frame(
                                websocket=websocket,
                                frame=make_error(
                                    id=next_id,
                                    chat_id=frame.chat_id,
                                    code="bad_request",
                                    message="MODEL frame requires 'model' field in payload",
                                    http=400,
                                ),
                            )
                    else:
                        logger.warning(
                            "[WS] MODEL frame with invalid payload: session_id=%s payload=%s",
                            session_id,
                            payload,
                        )
                        next_id = await _send_frame(
                            websocket=websocket,
                            frame=make_error(
                                id=next_id,
                                chat_id=frame.chat_id,
                                code="bad_request",
                                message="MODEL frame requires valid payload",
                                http=400,
                            ),
                        )
                    continue
                elif frame.op != Op.MESSAGE:
                    logger.warning("[WS] Unexpected op: op=%s session_id=%s", frame.op, session_id)
                    continue

                payload = frame.payload
                if payload is None:
                    logger.warning("[WS] No payload: op=%s session_id=%s", frame.op, session_id)
                    continue

                # Check if tools are provided in MESSAGE payload (e.g., from scheduler)
                # If so, use those tools instead of the ones from TOOLS frame
                msg_tools = payload.get("tools")
                if msg_tools is not None:
                    logger.info(
                        "[WS] Tools from MESSAGE payload: session_id=%s tools_count=%d",
                        session_id,
                        len(msg_tools) if isinstance(msg_tools, list) else 0,
                    )
                    # Convert tools from payload to ToolSpec format (ToolSpec is already imported at top)
                    try:
                        tools_specs = []
                        if isinstance(msg_tools, list):
                            for tool_dict in msg_tools:
                                if isinstance(tool_dict, dict):
                                    tools_specs.append(ToolSpec(
                                        name=tool_dict.get("name", ""),
                                        description=tool_dict.get("description", ""),
                                        parameters=tool_dict.get("parameters", {})
                                    ))
                        logger.info("[WS] Converted tools from payload: count=%d", len(tools_specs))
                    except Exception as e:
                        logger.warning("[WS] Failed to convert tools from payload: %s", e)

                # Check if model changed in MESSAGE payload and update current_model_name
                # This is needed when thinking mode auto-selects a different model
                msg_model = payload.get("model")
                model_changed = msg_model and msg_model != current_model_name
                if model_changed:
                    logger.info(
                        "[WS] Model from MESSAGE payload differs: session_id=%s current=%s new=%s - rebuilding agent",
                        session_id,
                        current_model_name,
                        msg_model,
                    )
                    current_model_name = msg_model
                    try:
                        agent = await agent_factory.build(
                            session_id,
                            tools_specs=tools_specs,
                            model_name=current_model_name,
                            agent_type=agent_type,
                            command_desc=command_desc,
                            web_search=current_web_search,
                            thinking=current_thinking,
                            user_id=session_id,
                            chat_id=chat_id_param,
                        )
                        logger.info(
                            "[WS] Agent rebuilt with new model: session_id=%s model=%s",
                            session_id,
                            current_model_name,
                        )
                    except Exception as e:
                        logger.error(
                            "[WS] Failed to rebuild agent for model change: session_id=%s model=%s error=%s",
                            session_id,
                            msg_model,
                            e,
                        )

                # Check if web_search setting changed and rebuild agent if needed
                requested_web_search = bool(payload.get("web_search", False))
                if requested_web_search != current_web_search:
                    logger.info(
                        "[WS] web_search changed: session_id=%s old=%s new=%s - rebuilding agent",
                        session_id,
                        current_web_search,
                        requested_web_search,
                    )
                    current_web_search = requested_web_search
                    try:
                        if is_team_mode:
                            # For team mode, include web_search in updated_desc if needed
                            pass  # Team mode doesn't support web_search per-message currently
                        else:
                            agent = await agent_factory.build(
                                session_id,
                                tools_specs=tools_specs,
                                model_name=current_model_name,
                                agent_type=agent_type,
                                command_desc=command_desc,
                                web_search=current_web_search,
                                thinking=current_thinking,
                                user_id=session_id,
                                chat_id=chat_id_param,
                            )
                            logger.info(
                                "[WS] Agent rebuilt with web_search=%s: session_id=%s",
                                current_web_search,
                                session_id,
                            )
                    except Exception as e:
                        logger.error(
                            "[WS] Failed to rebuild agent for web_search change: session_id=%s error=%s",
                            session_id,
                            e,
                        )
                        next_id = await _send_frame(
                            websocket=websocket,
                            frame=make_error(
                                id=next_id,
                                chat_id=frame.chat_id,
                                code="agent_rebuild_failed",
                                message="Failed to enable/disable web search",
                                http=500,
                                details={"error": str(e)},
                            ),
                        )
                        continue

                # Check if thinking setting changed and rebuild agent if needed
                requested_thinking_raw = payload.get("thinking")
                requested_thinking = "off"
                if isinstance(requested_thinking_raw, bool):
                     requested_thinking = "medium" if requested_thinking_raw else "off"
                elif isinstance(requested_thinking_raw, str):
                     requested_thinking = requested_thinking_raw.lower() or "off"

                if requested_thinking != current_thinking:
                    logger.info(
                        "[WS] thinking changed: session_id=%s old=%s new=%s - rebuilding agent",
                        session_id,
                        current_thinking,
                        requested_thinking,
                    )
                    current_thinking = requested_thinking
                    try:
                        if is_team_mode:
                            pass  # Team mode doesn't support thinking per-message currently
                        else:
                            agent = await agent_factory.build(
                                session_id,
                                tools_specs=tools_specs,
                                model_name=current_model_name,
                                agent_type=agent_type,
                                command_desc=command_desc,
                                web_search=current_web_search,
                                thinking=current_thinking,
                                user_id=session_id,
                                chat_id=chat_id_param,
                            )
                            logger.info(
                                "[WS] Agent rebuilt with thinking=%s: session_id=%s",
                                current_thinking,
                                session_id,
                            )
                    except Exception as e:
                        logger.error(
                            "[WS] Failed to rebuild agent for thinking change: session_id=%s error=%s",
                            session_id,
                            e,
                        )
                        next_id = await _send_frame(
                            websocket=websocket,
                            frame=make_error(
                                id=next_id,
                                chat_id=frame.chat_id,
                                code="agent_rebuild_failed",
                                message="Failed to enable/disable thinking mode",
                                http=500,
                                details={"error": str(e)},
                            ),
                        )
                        continue

                next_id = await _process_message(
                    agent=agent,
                    websocket=websocket,
                    text=payload.get("message", ""),
                    next_id=next_id,
                    session_id=session_id,
                    chat_id=frame.chat_id or "",
                    user_message_id=frame.message_id or "",
                    chat_history=chat_history,
                    current_model_name=current_model_name,
                    attachments=payload.get("attachments"),
                    web_search=requested_web_search,
                )
        except WebSocketDisconnect:
            # Клиент отвалился — нормальный сценарий
            logger.info("[WS] Disconnected: session_id=%s", session_id)
        except Exception as e:
            # Аварийное закрытие
            logger.exception("[WS] Fatal error: session_id=%s", session_id)
            try:
                await _send_error(websocket, next_id, e, session_id, chat_id=None)
            except Exception:
                pass
            with contextlib.suppress(Exception):
                await websocket.close(code=1011, reason="Server error")
            raise

    return r

async def _run_agent_stream(agent: Agent, text: str, session_id: Optional[str] = None, chat_history: Optional[list] = None, attachments: Optional[list] = None, web_search: bool = False):
    """Async generator yielding text chunks from the agent.

    Tries to use stream=True where supported; handles async/sync iterators
    and falls back to a single non-streaming result.
    """
    def _to_text(ev) -> str:
        try:
            if ev is None:
                return ""
            if hasattr(ev, "content"):
                val = getattr(ev, "content")
                return str(val) if val is not None else ""
            if hasattr(ev, "text"):
                val = getattr(ev, "text")
                return str(val) if val is not None else ""
            if isinstance(ev, dict):
                for k in ("content", "text", "delta", "message", "output"):
                    if k in ev and ev[k] is not None:
                        return str(ev[k])
            return str(ev) if ev is not None else ""
        except Exception:
            return ""

    async def _invoke_with_stream(fn):
        try:
            # Prepare kwargs
            kwargs = {"stream": True}
            if session_id:
                kwargs["session_id"] = session_id

            # Process attachments
            if attachments:
                images = []
                for att in attachments:
                    if isinstance(att, dict):
                        file_type = att.get("file_type", "")
                        content = att.get("content", "")
                        if file_type.startswith("image/") and content:
                            try:
                                import base64
                                from agno.media import Image
                                # Decode base64 content to bytes
                                image_bytes = base64.b64decode(content)
                                # Use content parameter instead of url to avoid httpx trying to fetch it
                                images.append(Image(content=image_bytes, format=file_type))
                                logger.info("[WS] 🖼️ Created Image with content bytes, size=%d, format=%s", len(image_bytes), file_type)
                            except Exception as e:
                                logger.error("[WS] Failed to create Image from content: %s", e)
                                # Fallback: try with data URI (might fail with long URLs)
                                try:
                                    data_uri = f"data:{file_type};base64,{content}"
                                    images.append(Image(url=data_uri))
                                    logger.warning("[WS] Using data URI fallback for image")
                                except Exception as e2:
                                    logger.error("[WS] Failed to create Image with data URI fallback: %s", e2)

                if images:
                    kwargs["images"] = images
                    logger.info("[WS] 🖼️  Passing %d images to agent", len(images))

            
            # Build full message history including current user message
            # Note: We ignore chat_history arg as we rely on Agno's DB history with add_history_to_context=True
            
            # Add current user message to history
            full_messages = [{
                "role": "user",
                "content": text
            }]
            logger.debug("[WS] 📜 Passing text to agent (Agno will use session-based history)")
            logger.debug("[WS] Agent kwargs: stream=True, session_id=%s", session_id)
            
            # DEBUG: Check agent memory if available
            if hasattr(agent, "memory") and agent.memory:
                 msgs = agent.memory.messages
                 logger.info("[WS] 🧠 Agent memory check: session_id=%s count=%d", session_id, len(msgs))
                 if msgs:
                     logger.debug("[WS] 🧠 First msg: %s", str(msgs[0])[:100])
            
            # EXPERIMENT: Let Agno manage history via session_id
            # We pass only text (current message), Agno will load history from its DB by session_id
            has_images = "images" in kwargs and kwargs["images"]
            if has_images:
                logger.info("[WS] 🖼️ Passing text with %d images to agent", len(kwargs["images"]))
                if asyncio.iscoroutinefunction(fn):
                    return await fn(text, stream=True, stream_events=True, session_id=session_id, images=kwargs["images"])
                return fn(text, stream=True, stream_events=True, session_id=session_id, images=kwargs["images"])
            else:
                # Pass just text - Agno will load history from session
                if asyncio.iscoroutinefunction(fn):
                    return await fn(text, stream=True, stream_events=True, session_id=session_id)
                return fn(text, stream=True, stream_events=True, session_id=session_id)

        except TypeError as e:
            # Fallback without stream or messages
            logger.warning("[WS] TypeError calling agent, falling back: %s", e)
            if asyncio.iscoroutinefunction(fn):
                return await fn(text)
            return fn(text)
        finally:
            pass

    # Call agent entrypoints
    result = None
    
    # Try async run first (required for async tools)
    arun = getattr(agent, "arun", None)
    if arun is not None:
        result = await _invoke_with_stream(arun)
        
    if result is None:
        run = getattr(agent, "run", None)
        if run is not None:
            result = await _invoke_with_stream(run)
    if result is None:
        for m in ("generate", "respond", "chat"):
            fn = getattr(agent, m, None)
            if fn is None:
                continue
            result = await _invoke_with_stream(fn)
            if result is not None:
                break
    if result is None:
        raise RuntimeError("Agent does not have a callable interface for text input")

    # Async iterator → stream
    # Initialize storage for tool executions on the agent instance
    agent.last_tool_executions = []
    
    if hasattr(result, "__aiter__"):
        async for ev in result:  # type: ignore
            # Log event type to understand what we are getting
            # logger.debug("[WS] Stream event: type=%s val=%s", type(ev), str(ev)[:100])
            
            # Capture tool executions from ToolCallCompletedEvent
            if "ToolCallCompleted" in str(type(ev)):
                if hasattr(ev, 'tool') and ev.tool:
                    logger.info("[WS] 🔧 Tool execution event: %s", str(ev))
                    agent.last_tool_executions.append(ev.tool)
            
            # Check if ev is RunOutput (has tools or tool_calls) and save it - fallback
            if hasattr(ev, 'tools') and ev.tools:
                 agent.run_response = ev
                 # logger.debug("[WS] Captured RunOutput with tools in stream")
            elif hasattr(ev, 'tool_calls') and ev.tool_calls: # Legacy/Other models
                 agent.run_response = ev
                 # logger.debug("[WS] Captured RunOutput with tool_calls in stream")
            
            # Log ALL events for debugging
            event_type = type(ev).__name__
            # Debug log to inspect event attributes for missing reasoning
            if "Content" in event_type or "Reasoning" in event_type:
                logger.debug("[WS] 📦 Stream event: type=%s attrs=%s", event_type, dir(ev))
            else:
                logger.debug("[WS] 📦 Stream event: type=%s", event_type)
            
            # Check for thought in parts (Gemini 2.0)
            has_thought_in_parts = False
            if hasattr(ev, 'parts'):
                try:
                    for part in ev.parts:
                        if hasattr(part, 'thought') and part.thought:
                            has_thought_in_parts = True
                            break
                except Exception:
                    pass

            # Capture reasoning events (including Gemini thoughts and Agno reasoning)
            # reasoning_content: used in ReasoningStepEvent and RunResponseCompletedEvent
            # thinking: used in RunResponseContentEvent (Anthropic) and RunResponseCompletedEvent
            
            captured_reasoning = None
            
            # 1. Check for standard Agno reasoning_content
            if hasattr(ev, 'reasoning_content') and ev.reasoning_content:
                captured_reasoning = ev.reasoning_content
                
            # 2. Check for thinking attribute (Anthropic style / RunResponseContentEvent)
            elif hasattr(ev, 'thinking') and ev.thinking:
                captured_reasoning = ev.thinking
                
            # 3. Check for Gemini native thoughts in parts
            elif has_thought_in_parts:
                for part in ev.parts:
                    if hasattr(part, 'thought') and part.thought:
                        captured_reasoning = part.text
                        break
                        
            # 4. Fallback for Reasoning events (older styles or direct content)
            elif "ReasoningStep" in event_type or "Reasoning" in event_type:
                 if hasattr(ev, 'content') and ev.content:
                     captured_reasoning = ev.content

            if captured_reasoning:
                if not hasattr(agent, 'reasoning_steps'):
                    agent.reasoning_steps = []
                agent.reasoning_steps.append(captured_reasoning)
                logger.debug("[WS] 🧠 Captured reasoning/thought: %s", str(captured_reasoning)[:100])
                # Yield special object for reasoning to be streamed immediately
                yield {"type": "reasoning", "content": captured_reasoning}
            
            # Only yield text from Content events to avoid duplication (RunCompletedEvent has full text)
            # and system messages (ToolCallCompletedEvent has status text)
            if "RunContentEvent" in str(type(ev)):
                chunk = _to_text(ev)
                # Ensure we don't yield reasoning as content if Agno mixed them (unlikely but possible)
                if chunk and chunk != captured_reasoning:
                    logger.debug("[WS] 📝 Yielding content chunk: len=%d preview=%s", len(chunk), chunk[:50] if len(chunk) > 50 else chunk)
                    yield chunk
            elif "ModelContentEvent" in str(type(ev)) or "TextDeltaEvent" in str(type(ev)):
                # Try other event types that might contain text
                chunk = _to_text(ev)
                if chunk:
                    logger.debug("[WS] 📝 Yielding model/delta chunk: len=%d preview=%s", len(chunk), chunk[:50] if len(chunk) > 50 else chunk)
                    yield chunk
        return

    # Sync iterator → stream
    if hasattr(result, "__iter__") and not isinstance(result, (str, bytes, bytearray)):
        try:
            for ev in result:  # type: ignore
                chunk = _to_text(ev)
                if chunk:
                    yield chunk
            return
        except TypeError:
            pass

    # Single value
    chunk = _to_text(result)
    if chunk:
        yield chunk


def _chunk_text(s: str, size: int = 24):
    return [s[i : i + size] for i in range(0, len(s), size)] if s else []


def _classify_error(exc: Exception) -> Tuple[int, str, str]:
    s = str(exc)
    if "429" in s or "RESOURCE_EXHAUSTED" in s or "Too Many Requests" in s:
        return 429, "rate_limited", "Too many requests. Try later."
    if "503" in s or "unavailable" in s.lower():
        return 503, "upstream_unavailable", "Service is temporally unavailable. Try later."
    if "timeout" in s.lower():
        return 504, "upstream_timeout", "Request timed out. Please try again."
    if "context_length_exceeded" in s:
        return 400, "context_length_exceeded", "Context length exceeded."
    
    # Generic fallback
    return 500, "internal_error", f"Internal Server Error: {s}"
#
#
# # --- WS helpers ---
# async def _send_meta(websocket: WebSocket, next_id: int, data: dict) -> int:
#     await websocket.send_json({"id": next_id, "event": "meta", "data": data})
#     return next_id + 1
#
#
# async def _send_token(websocket: WebSocket, next_id: int, delta: str, index: int, message_id: str) -> int:
#     await websocket.send_json({
#         "id": next_id,
#         "event": "token",
#         "data": {"delta": delta, "index": index, "message_id": message_id},
#     })
#     return next_id + 1
#
# async def _send_done(websocket: WebSocket, next_id: int, message_id: str, finish_reason: str) -> int:
#     await websocket.send_json({
#         "id": next_id,
#         "event": "done",
#         "data": {"message_id": message_id, "finish_reason": finish_reason},
#     })
#     return next_id + 1
#
#
# def _extract_text_from_payload(msg: dict) -> Optional[str]:
#     if not isinstance(msg, dict):
#         return None
#     val = msg.get('data', {}).get("message") or msg.get("q")
#     if val is None:
#         return None
#     text = str(val)
#     return text if text.strip() else None
#
#

async def _send_done(
    websocket: WebSocket,
    next_id: int,
    message_id: str,
    reason: str,
    chat_id:str,
):
    return await _send_frame(
        websocket=websocket,
        frame=make_done(
            id=next_id,
            chat_id=chat_id,
            payload={
                "message_id": message_id,
                "reason": reason,
            }
        ),
    )

async def _send_error(
    websocket: WebSocket,
    next_id: int,
    e: Exception,
    session_id: str,
    chat_id: Optional[str],
) -> int:
    http_status, status_text, user_msg = _classify_error(e)
    logger.error("[WS] Agent failed: sessionId=%s status=%s detail=%s", session_id, status_text, e)
    return await _send_frame(
        websocket=websocket,
        frame=make_error(
            id=next_id,
            chat_id=chat_id,
            code=status_text,
            message=user_msg,
            http=http_status,
        ),
    )

async def _send_frame(
    websocket: WebSocket,
    frame: Frame,
) -> int:
    data = frame.marshal()
    logger.debug("[WS] Sending frame: op=%s id=%d payload_len=%d", frame.op, frame.id, len(str(data.get("payload", ""))))
    await websocket.send_json(data)
    return frame.id+1


async def _wait_for_tools_response(
    websocket: WebSocket,
    request_id: int,
    session_id: str,
    timeout: float = 10.0,
) -> List[ToolSpec]:
    """
    Ждет ответ с инструментами от genie-api.
    Возвращает список ToolSpec объектов.
    """
    import json
    
    try:
        # Ждем ответ с инструментами с таймаутом
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=timeout)
        data = json.loads(raw)
        frame = Frame(**data)
        
        # Проверяем, что это ответ на наш запрос инструментов
        if frame.op == Op.TOOLS and frame.id == request_id:
            payload = frame.payload
            logger.debug("[WS] Tools response payload raw: session_id=%s payload=%s", session_id, payload)
            if payload is None:
                logger.warning("[WS] Empty tools payload: session_id=%s", session_id)
                return []
            
            # Преобразуем payload в dict, если это еще не dict
            if not isinstance(payload, dict):
                payload = payload if hasattr(payload, '__dict__') else {}
            
            # Структура ответа: payload.tools.tools (вложенный объект)
            # Или может быть payload.tools если tools - это сразу список
            tools_obj = payload.get("tools") if isinstance(payload, dict) else None
            
            if tools_obj is None:
                logger.warning("[WS] No tools in payload: session_id=%s payload=%s", session_id, payload)
                return []
            
            # Извлекаем список инструментов
            if isinstance(tools_obj, dict):
                tools_data = tools_obj.get("tools", [])
            elif isinstance(tools_obj, list):
                tools_data = tools_obj
            else:
                logger.warning("[WS] Unexpected tools format: session_id=%s tools_obj=%s", session_id, tools_obj)
                return []
            
            if isinstance(tools_data, list):
                tools = []
                for tool_dict in tools_data:
                    if not isinstance(tool_dict, dict):
                        continue
                    try:
                        # Парсим params, если это строка JSON
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
                        tools.append(tool_spec)
                    except Exception as e:
                        logger.warning(
                            "[WS] Failed to parse tool: session_id=%s error=%s tool=%s",
                            session_id,
                            e,
                            tool_dict,
                        )
                        continue
                tool_names = [t.name for t in tools]
                logger.info(
                    "[WS] Received tools response: session_id=%s count=%d names=%s",
                    session_id,
                    len(tools),
                    tool_names,
                )
                logger.debug("[WS] Tools response details: session_id=%s specs=%s", session_id, tools)
                return tools
        
        # Если это не ответ с инструментами, возвращаем пустой список
        logger.warning(
            "[WS] Unexpected frame while waiting for tools: session_id=%s op=%s id=%d",
            session_id,
            frame.op,
            frame.id,
        )
        return []
    except asyncio.TimeoutError:
        logger.warning(
            "[WS] Timeout waiting for tools response: session_id=%s timeout=%.1f",
            session_id,
            timeout,
        )
        return []
    except Exception as exc:
        logger.warning(
            "[WS] Error waiting for tools response: session_id=%s error=%s",
            session_id,
            exc,
        )
        return []

async def _process_message(
    agent: Agent,
    websocket: WebSocket,
    text: str,
    next_id: int,
    session_id: str,
    chat_id: str,
    user_message_id: str,
    chat_history: Optional[list] = None,
    current_model_name: Optional[str] = None,
    attachments: Optional[list] = None,
    web_search: Optional[bool] = False,
) -> int:
    message_id = str(uuid.uuid4())

    # Signal message start
    logger.info(
        "[WS] Start message: sessionId=%s message_id=%s text_len=%d user_message_id=%s model=%s attachments=%d",
        session_id,
        message_id,
        len(text or ""),
        user_message_id,
        current_model_name,
        len(attachments or []),
    )
    next_id = await _send_frame(
        websocket=websocket,
        frame=make_meta(
            id=next_id,
            op=Op.MESSAGE,
            chat_id=chat_id,
            payload={
                "message_id": message_id,
            }
        ),
    )

    started = time.monotonic()
    tool_calls_list = []
    
    try:
        idx = 0
        sent_token_events = 0
        total_delta_len = 0
        
        logger.debug("[WS] Starting agent stream: session_id=%s", session_id)
        
        # Log chat history if provided
        if chat_history:
            logger.info("[WS] 📜 Using chat history: session_id=%s count=%d", session_id, len(chat_history))
        else:
            logger.debug("[WS] No chat history provided: session_id=%s", session_id)

        async for chunk in _run_agent_stream(agent, text or "", session_id=session_id, chat_history=chat_history, attachments=attachments, web_search=web_search):
            # Check for reasoning object
            if isinstance(chunk, dict) and chunk.get("type") == "reasoning":
                logger.info("[WS] 🧠 Streaming reasoning content: %s...", str(chunk.get("content"))[:20])
                next_id = await _send_frame(
                    websocket=websocket,
                    frame=make_meta(
                        id=next_id,
                        op=Op.MESSAGE,
                        chat_id=chat_id,
                        payload={
                            "type": "metadata",
                            "message_id": message_id,
                            "reasoning_steps": [chunk.get("content")]
                        }
                    )
                )
                continue

            # Skip empty or 'None' chunks
            if not chunk or chunk == "None":
                if chunk == "None":
                    logger.debug("[WS] Filtered unexpected 'None' chunk")
                continue
            # logger.debug("[WS] Stream chunk: len=%d", len(chunk))
            next_id = await _send_frame(
                websocket=websocket,
                frame=make_data(
                    id=next_id,
                    chat_id=chat_id,
                    op=Op.MESSAGE,
                    payload={
                        "ix": idx,
                        "eof": False,
                        "message": chunk,
                        "message_id": message_id,
                    }
                ),
            )
            idx += 1
            sent_token_events += 1
            total_delta_len += len(chunk)
        
        logger.debug("[WS] Agent stream finished: session_id=%s tokens=%d", session_id, sent_token_events)
        
        # Try to extract tool calls from agent's run_response
        try:
            logger.debug("[WS] Checking for tool calls...")
            
            # 1. Check for captured tool executions from stream events (MOST RELIABLE for stream=True)
            if hasattr(agent, 'last_tool_executions') and agent.last_tool_executions:
                 tools_list = agent.last_tool_executions
                 logger.info("[WS] 🔧 Captured tools from agent.last_tool_executions: count=%d", len(tools_list))
                 
                 serializable_tool_calls = []
                 for tc in tools_list:
                    tool_call_dict = {
                        "name": getattr(tc, 'tool_name', 'unknown'),
                        "arguments": getattr(tc, 'tool_args', {}),
                        "result": getattr(tc, 'result', None)
                    }
                    serializable_tool_calls.append(tool_call_dict)
                 tool_calls_list = serializable_tool_calls
            
            # 2. Check RunOutput (if available)
            elif hasattr(agent, 'run_response'):
                run_response = agent.run_response
                if run_response:
                    if hasattr(run_response, 'tools') and run_response.tools:
                        # ... existing logic ...
                        tools_list = run_response.tools
                        logger.info("[WS] 🔧 Captured tools from run_response.tools: count=%d", len(tools_list))
                        
                        serializable_tool_calls = []
                        for tc in tools_list:
                            # Map ToolExecution to standard format
                            tool_call_dict = {
                                "name": getattr(tc, 'tool_name', 'unknown'),
                                "arguments": getattr(tc, 'tool_args', {})
                            }
                            serializable_tool_calls.append(tool_call_dict)
                        
                        tool_calls_list = serializable_tool_calls
                    
                    elif hasattr(run_response, 'tool_calls') and run_response.tool_calls:
                         # ... existing logic ...
                         tool_calls_list = run_response.tool_calls

            # 3. Check Memory (fallback)
            if not tool_calls_list and hasattr(agent, 'memory') and agent.memory and agent.memory.runs:
                 # ... existing logic could go here, but omitted for brevity as stream capture covers it ...
                 pass

            # Convert tool calls to serializable format (if they came from legacy paths and not already converted)
            if tool_calls_list and not isinstance(tool_calls_list[0], dict):
                 # ... legacy conversion logic ...
                    serializable_tool_calls = []
                    for tc in tool_calls_list:
                        tool_call_dict = {
                            "name": getattr(tc, 'function', {}).get('name') if hasattr(tc, 'function') else getattr(tc, 'name', 'unknown'),
                        }
                        # Try to get arguments
                        if hasattr(tc, 'function') and hasattr(tc.function, 'arguments'):
                            try:
                                import json as json_lib
                                tool_call_dict["arguments"] = json_lib.loads(tc.function.arguments) if isinstance(tc.function.arguments, str) else tc.function.arguments
                            except:
                                tool_call_dict["arguments"] = str(tc.function.arguments)
                        elif hasattr(tc, 'arguments'):
                            tool_call_dict["arguments"] = tc.arguments
                        serializable_tool_calls.append(tool_call_dict)
                    tool_calls_list = serializable_tool_calls

            if tool_calls_list:
                logger.debug("[WS] Serialized tool calls: %s", tool_calls_list)
        except Exception as e:
            logger.warning("[WS] Failed to extract tool calls: session_id=%s error=%s", session_id, e, exc_info=True)
            
    except Exception as e:
        logger.error("[WS] Error in agent stream: session_id=%s error=%s", session_id, e, exc_info=True)
        next_id = await _send_error(websocket, next_id, e, session_id, chat_id)
        return await _send_done(websocket, next_id, message_id, "error", chat_id)

    # Send final EOF frame
    next_id = await _send_frame(
        websocket=websocket,
        frame=make_data(
            id=next_id,
            chat_id=chat_id,
            op=Op.MESSAGE,
            payload={
                "ix": idx,
                "eof": True,
                "message": "",
                "message_id": message_id,
            }
        ),
    )

    # Usage
    elapsed = time.monotonic() - started
    next_id = await _send_frame(
        websocket=websocket,
        frame=make_meta(
            id=next_id,
            op=Op.MESSAGE,
            chat_id=chat_id,
            payload={
                "type": "usage",
                "prompt_tokens": len(text or "") // 4,
                "completion_tokens": total_delta_len // 4,
                "elapsed_ms": int(elapsed * 1000),
                "message_id": message_id,
            }
        )
    )
    logger.info(
        "[WS] Sent tokens: sessionId=%s events=%d delta_len=%d elapsed_ms=%d",
        session_id,
        sent_token_events,
        total_delta_len,
        int(elapsed * 1000),
    )

    # Send tool calls and model metadata before done frame
    metadata_payload = {}
    if tool_calls_list:
        metadata_payload["tool_calls"] = tool_calls_list
        logger.info("[WS] 🔧 Sending tool calls: count=%d", len(tool_calls_list))
    if current_model_name:
        metadata_payload["model"] = current_model_name
        logger.info("[WS] 📊 Sending model: %s", current_model_name)
    
    # Add reasoning steps if captured
    if hasattr(agent, 'reasoning_steps') and agent.reasoning_steps:
        metadata_payload["reasoning_steps"] = agent.reasoning_steps
        logger.info("[WS] 🧠 Sending reasoning steps: count=%d", len(agent.reasoning_steps))
    
    if metadata_payload:
        next_id = await _send_frame(
            websocket=websocket,
            frame=make_meta(
                id=next_id,
                op=Op.MESSAGE,
                chat_id=chat_id,
                payload={
                    "type": "metadata",
                    "message_id": message_id,
                    **metadata_payload
                }
            )
        )

    # Done
    next_id = await _send_done(websocket, next_id, message_id, "stop", chat_id)
    logger.info(
        "[WS] Done message: sessionId=%s message_id=%s",
        session_id,
        message_id,
    )
    return next_id
#
# def router(agent) -> APIRouter:
#     r = APIRouter()
#
#     @r.websocket("/llm/ws")
#     async def llm_ws(websocket: WebSocket):
#         await websocket.accept()
#         session_id: Optional[str] = websocket.query_params.get("sessionId")
#         q: Optional[str] = websocket.query_params.get("q")
#
#         next_id = 1
#         logger.info("[WS] Open connection: sessionId=%s has_q=%s", session_id, bool(q))
#
#         # Process messages in a loop until the client disconnects
#         pending: Optional[str] = q
#         try:
#             while True:
#                 # Read next message if nothing pending
#                 if pending is None:
#                     try:
#                         msg = await websocket.receive_json()
#                         pending = _extract_text_from_payload(msg)
#                         if pending is None:
#                             logger.warning("[WS] Empty message. sessionId=%s", session_id)
#                             message_id = str(uuid.uuid4())
#                             next_id = await _send_meta(websocket, next_id, {
#                                 "type": "error",
#                                 "status": "bad_request",
#                                 "http_status": 400,
#                                 "message": "Отсутствует сообщение",
#                                 "message_id": message_id,
#                             })
#                             next_id = await _send_done(websocket, next_id, message_id, "error")
#                             pending = None
#                             continue
#                         logger.info("[WS] Received message: sessionId=%s len=%s", session_id, len(pending or ""))
#                     except WebSocketDisconnect:
#                         logger.info("[WS] Client disconnected: sessionId=%s", session_id)
#                         return
#                     except Exception:
#                         logger.warning("[WS] Bad request payload. sessionId=%s", session_id)
#                         message_id = str(uuid.uuid4())
#                         next_id = await _send_meta(websocket, next_id, {
#                             "type": "error",
#                             "status": "bad_request",
#                             "http_status": 400,
#                             "message": "Неверный формат сообщения",
#                             "message_id": message_id,
#                         })
#                         next_id = await _send_done(websocket, next_id, message_id, "error")
#                         pending = None
#                         continue
#
#                 # Process valid message
#                 next_id = await _process_message(agent, websocket, session_id, next_id, pending)
#
#                 # Reset pending and wait for the next client message
#                 pending = None
#         except WebSocketDisconnect:
#             logger.info("[WS] Client disconnected: sessionId=%s", session_id)
#         except Exception:
#             logger.exception("[WS] Unexpected error: sessionId=%s", session_id)
#             try:
#                 await websocket.send_json({
#                     "id": next_id,
#                     "event": "meta",
#                     "data": {"type": "error", "status": "internal_error", "http_status": 500, "message": "Произошла ошибка"},
#                 })
#                 await websocket.send_json({
#                     "id": next_id + 1,
#                     "event": "done",
#                     "data": {"message_id": str(uuid.uuid4()), "finish_reason": "error"},
#                 })
#             except Exception:
#                 pass
#
#     return r
