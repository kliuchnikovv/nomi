import asyncio
import json
import logging
import time
import uuid
from typing import Optional, Tuple

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


async def _run_agent_text(agent, text: str) -> str:
    run = getattr(agent, "run", None)
    if asyncio.iscoroutinefunction(run):
        result = await run(text)
    elif callable(run):
        result = run(text)
    else:
        for m in ("generate", "respond", "chat"):
            fn = getattr(agent, m, None)
            if asyncio.iscoroutinefunction(fn):
                result = await fn(text)
                break
            if callable(fn):
                result = fn(text)
                break
        else:
            raise RuntimeError("Agent does not have a callable interface for text input")
    if hasattr(result, "content"):
        return str(getattr(result, "content"))
    return str(result)


def _chunk_text(s: str, size: int = 24):
    return [s[i : i + size] for i in range(0, len(s), size)] if s else []


def _classify_error(exc: Exception) -> Tuple[int, str, str]:
    s = str(exc)
    if "429" in s or "RESOURCE_EXHAUSTED" in s or "Too Many Requests" in s:
        return 429, "rate_limited", "Слишком много запросов. Повторите позже."
    if "503" in s or "unavailable" in s.lower():
        return 503, "upstream_unavailable", "Сервис временно недоступен. Попробуйте позже."
    if "timeout" in s.lower():
        return 504, "upstream_timeout", "Время ожидания истекло. Повторите запрос."
    return 500, "internal_error", "Произошла ошибка. Мы уже работаем над этим."


def router(agent) -> APIRouter:
    r = APIRouter()

    @r.websocket("/llm/ws")
    async def llm_ws(websocket: WebSocket):
        await websocket.accept()
        session_id: Optional[str] = websocket.query_params.get("sessionId")
        q: Optional[str] = websocket.query_params.get("q")
        next_id = 1
        logger.info("[WS] Open connection: sessionId=%s has_q=%s", session_id, bool(q))
        try:
            # If no query message, wait for first client message
            if not q:
                try:
                    msg = await websocket.receive_json()
                    q = msg.get("message") or msg.get("q")
                    logger.info("[WS] Received first client message: sessionId=%s len=%s", session_id, len(q or ""))
                except WebSocketDisconnect:
                    logger.info("[WS] Disconnected before first message: sessionId=%s", session_id)
                    return
                except Exception:
                    logger.warning("[WS] Bad request: no message provided. sessionId=%s", session_id)
                    await websocket.send_json({
                        "id": next_id,
                        "event": "meta",
                        "data": {"type": "error", "status": "bad_request", "http_status": 400, "message": "Отсутствует сообщение"},
                    })
                    next_id += 1
                    await websocket.send_json({
                        "id": next_id,
                        "event": "done",
                        "data": {"message_id": f"msg_{uuid.uuid4().hex}", "finish_reason": "error"},
                    })
                    await websocket.close(code=1003)
                    return

            started = time.monotonic()
            try:
                text = await _run_agent_text(agent, q or "")
            except Exception as e:
                http_status, status_text, user_msg = _classify_error(e)
                logger.error("[WS] Agent failed: sessionId=%s status=%s detail=%s", session_id, status_text, e)
                await websocket.send_json({
                    "id": next_id,
                    "event": "meta",
                    "data": {"type": "error", "status": status_text, "http_status": http_status, "message": user_msg},
                })
                next_id += 1
                await websocket.send_json({
                    "id": next_id,
                    "event": "done",
                    "data": {"message_id": f"msg_{uuid.uuid4().hex}", "finish_reason": "error"},
                })
                await websocket.close(code=1011)
                return

            # Stream token chunks
            sent_token_events = 0
            total_delta_len = 0
            for idx, chunk in enumerate(_chunk_text(text)):
                await websocket.send_json({
                    "id": next_id,
                    "event": "token",
                    "data": {"delta": chunk, "index": idx},
                })
                next_id += 1
                sent_token_events += 1
                total_delta_len += len(chunk)

            # Meta
            elapsed = time.monotonic() - started
            await websocket.send_json({
                "id": next_id,
                "event": "meta",
                "data": {
                    "type": "usage",
                    "prompt_tokens": len(q or "") // 4,
                    "completion_tokens": len(text) // 4,
                    "elapsed_ms": int(elapsed * 1000),
                },
            })
            next_id += 1
            logger.info(
                "[WS] Sent tokens: sessionId=%s events=%d delta_len=%d elapsed_ms=%d",
                session_id,
                sent_token_events,
                total_delta_len,
                int(elapsed * 1000),
            )

            # Done
            await websocket.send_json({
                "id": next_id,
                "event": "done",
                "data": {"message_id": f"msg_{uuid.uuid4().hex}", "finish_reason": "stop"},
            })
            await websocket.close(code=1000)
            logger.info("[WS] Closed connection: sessionId=%s", session_id)
        except WebSocketDisconnect:
            logger.info("[WS] Client disconnected: sessionId=%s", session_id)
        except Exception as e:
            logger.exception("[WS] Unexpected error: sessionId=%s", session_id)
            try:
                await websocket.send_json({
                    "id": next_id,
                    "event": "meta",
                    "data": {"type": "error", "status": "internal_error", "http_status": 500, "message": "Произошла ошибка"},
                })
                await websocket.send_json({
                    "id": next_id + 1,
                    "event": "done",
                    "data": {"message_id": f"msg_{uuid.uuid4().hex}", "finish_reason": "error"},
                })
            except Exception:
                pass
            try:
                await websocket.close(code=1011)
            except Exception:
                pass

    return r
