import asyncio
import contextlib
import json
import logging
import time
import uuid

from agno.agent import Agent
from typing import Optional, Tuple
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, Cookie

from src.server.models import Frame, Kind, Op
from src.server.utils import make_meta, make_error, make_done, make_data

logger = logging.getLogger(__name__)



def router(agent: Agent) -> APIRouter:
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
            return

        await websocket.accept()
        logger.info("[WS] Open: session_id=%s", session_id)

        next_id = 0
        # Track last time we received any client message
        last_activity = time.monotonic()
        try:
            # Пример: таймауты чтения (idle close)
            while True:
                try:
                    raw = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                    # Any received frame counts as activity
                    last_activity = time.monotonic()
                    try:
                        data = json.loads(raw)
                        frame = Frame(**data)
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
                elif frame.op != Op.MESSAGE:
                    logger.warning("[WS] Unexpected op: op=%s session_id=%s", frame.op, session_id)
                    continue

                payload = frame.payload
                if payload is None:
                    logger.warning("[WS] No payload: op=%s session_id=%s", frame.op, session_id)
                    continue

                next_id = await _process_message(
                    agent=agent,
                    websocket=websocket,
                    text=payload.get("message", ""),
                    next_id=next_id,
                    session_id=session_id,
                    chat_id=frame.chat_id or "",
                    user_message_id=frame.message_id or "",
                )
        except WebSocketDisconnect:
            # Клиент отвалился — нормальный сценарий
            logger.info("[WS] Disconnected: session_id=%s", session_id)
        except Exception as e:
            # Аварийное закрытие
            with contextlib.suppress(Exception):
                await websocket.close(code=1011, reason="Server error")
            logger.exception("[WS] Fatal error: session_id=%s", session_id)
            raise

    return r

async def _run_agent_stream(agent: Agent, text: str):
    """Async generator yielding text chunks from the agent.

    Tries to use stream=True where supported; handles async/sync iterators
    and falls back to a single non-streaming result.
    """
    def _to_text(ev) -> str:
        try:
            if ev is None:
                return ""
            if hasattr(ev, "content"):
                return str(getattr(ev, "content"))
            if hasattr(ev, "text"):
                return str(getattr(ev, "text"))
            if isinstance(ev, dict):
                for k in ("content", "text", "delta", "message", "output"):
                    if k in ev and ev[k] is not None:
                        return str(ev[k])
            return str(ev)
        except Exception:
            return ""

    async def _invoke_with_stream(fn):
        try:
            if asyncio.iscoroutinefunction(fn):
                return await fn(text, stream=True)
            return fn(text, stream=True)
        except TypeError:
            if asyncio.iscoroutinefunction(fn):
                return await fn(text)
            return fn(text)

    # Call agent entrypoints
    result = None
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
    if hasattr(result, "__aiter__"):
        async for ev in result:  # type: ignore
            chunk = _to_text(ev)
            if chunk:
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
        return 504, "upstream_timeout", "Время ожидания истекло. Повторите запрос."
    return 500, "internal_error", "Internal Server Error. We're on our way to fix it."
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
    chat_id: str,
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
    await websocket.send_json(frame.marshal())
    return frame.id+1

async def _process_message(
    agent: Agent,
    websocket: WebSocket,
    text: str,
    next_id: int,
    session_id: str,
    chat_id: str,
    user_message_id: str,
) -> int:
    message_id = str(uuid.uuid4())

    # Signal message start
    logger.info(
        "[WS] Start message: sessionId=%s message_id=%s text_len=%d user_message_id=%s",
        session_id,
        message_id,
        len(text or ""),
        user_message_id,
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
    try:
        idx = 0
        sent_token_events = 0
        total_delta_len = 0

        async for chunk in _run_agent_stream(agent, text or ""):
            if not chunk:
                continue
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
    except Exception as e:
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
