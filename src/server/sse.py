import asyncio
import json
import logging
import os
import time
import uuid
from typing import AsyncIterator, Optional, Tuple

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)


def _sse_frame(event: str, data: dict, eid: Optional[int] = None) -> str:
    parts = []
    if eid is not None:
        parts.append(f"id: {eid}")
    parts.append(f"event: {event}")
    parts.append("data: " + json.dumps(data, ensure_ascii=False))
    parts.append("")  # blank line terminator
    return "\n".join(parts) + "\n"


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


def _chunk_text(s: str, size: int = 24) -> list[str]:
    return [s[i : i + size] for i in range(0, len(s), size)] if s else []


def router(agent) -> APIRouter:
    r = APIRouter()

    @r.get("/llm/stream")
    async def llm_stream_get(request: Request, sessionId: Optional[str] = None, q: Optional[str] = None, message: Optional[str] = None):
        # Accept either q or message; if missing, emit error via SSE stream
        msg = q or message
        return _stream_response(agent, request, sessionId=sessionId, message=msg)

    @r.post("/llm/stream")
    async def llm_stream_post(request: Request):
        try:
            payload = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")
        session_id = payload.get("sessionId") or payload.get("session_id")
        message = payload.get("message") or payload.get("q")
        return _stream_response(agent, request, sessionId=session_id, message=message)

    return r


def _stream_response(agent, request: Request, sessionId: Optional[str], message: Optional[str]) -> StreamingResponse:
    def _classify_error(exc: Exception) -> Tuple[int, str, str]:
        # Returns: (http_status, status_text, user_message)
        s = str(exc)
        # Try exact matches for common providers
        if "429" in s or "RESOURCE_EXHAUSTED" in s or "Too Many Requests" in s:
            return 429, "rate_limited", "Слишком много запросов. Повторите позже."
        if "503" in s or "unavailable" in s.lower():
            return 503, "upstream_unavailable", "Сервис временно недоступен. Попробуйте позже."
        if "timeout" in s.lower():
            return 504, "upstream_timeout", "Время ожидания истекло. Повторите запрос."
        return 500, "internal_error", "Произошла ошибка. Мы уже работаем над этим."

    async def gen() -> AsyncIterator[bytes]:
        last_id_hdr = request.headers.get("Last-Event-ID")
        try:
            next_id = int(last_id_hdr) + 1 if last_id_hdr else 1
        except Exception:
            next_id = 1

        logger.info(
            "[SSE] Open stream: sessionId=%s last_event_id=%s message_len=%s",
            sessionId,
            last_id_hdr or "-",
            len(message or ""),
        )

        sent_token_events = 0
        total_delta_len = 0

        # If no message provided, emit bad_request via stream (keeps SSE contract)
        if not message:
            logger.warning("[SSE] Bad request: missing message/q. sessionId=%s", sessionId)
            yield _sse_frame(
                "meta",
                {"type": "error", "status": "bad_request", "http_status": 400, "message": "Отсутствует запрос (q/message)"},
                eid=next_id,
            ).encode()
            next_id += 1
            yield _sse_frame(
                "done",
                {"message_id": f"msg_{uuid.uuid4().hex}", "finish_reason": "error"},
                eid=next_id,
            ).encode()
            return

        started = time.monotonic()
        try:
            text = await _run_agent_text(agent, message)
        except Exception as e:
            http_status, status_text, user_msg = _classify_error(e)
            logger.error("[SSE] Agent failed: sessionId=%s status=%s detail=%s", sessionId, status_text, e)
            # Send a structured error meta and done to gracefully close
            yield _sse_frame(
                "meta",
                {
                    "type": "error",
                    "status": status_text,
                    "http_status": http_status,
                    "message": user_msg,
                },
                eid=next_id,
            ).encode()
            next_id += 1
            yield _sse_frame(
                "done",
                {
                    "message_id": f"msg_{uuid.uuid4().hex}",
                    "finish_reason": "error",
                },
                eid=next_id,
            ).encode()
            logger.info(
                "[SSE] Closed with error: sessionId=%s status=%s", sessionId, status_text
            )
            return

        # Stream token chunks
        for idx, chunk in enumerate(_chunk_text(text)):
            payload = {"delta": chunk, "index": idx}
            yield _sse_frame("token", payload, eid=next_id).encode()
            next_id += 1
            sent_token_events += 1
            total_delta_len += len(chunk)

        # Meta: simple usage proxy
        elapsed = time.monotonic() - started
        meta = {
            "type": "usage",
            "prompt_tokens": len(message) // 4,
            "completion_tokens": len(text) // 4,
            "elapsed_ms": int(elapsed * 1000),
        }
        yield _sse_frame("meta", meta, eid=next_id).encode()
        next_id += 1
        logger.info(
            "[SSE] Sent tokens: sessionId=%s events=%d delta_len=%d elapsed_ms=%d",
            sessionId,
            sent_token_events,
            total_delta_len,
            meta["elapsed_ms"],
        )

        # Done
        done = {"message_id": f"msg_{uuid.uuid4().hex}", "finish_reason": "stop"}
        yield _sse_frame("done", done, eid=next_id).encode()
        logger.info(
            "[SSE] Closed stream: sessionId=%s message_id=%s", sessionId, done["message_id"]
        )

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",  # nginx: disable buffering
    }
    return StreamingResponse(gen(), media_type="text/event-stream", headers=headers)
