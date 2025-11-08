from datetime import datetime, timezone

from src.server.models import Op, Frame, Kind, ErrorInfo


def now() -> datetime:
    return datetime.now(timezone.utc)

def make_data(id: int, op: Op, payload: dict, **kw) -> Frame:
    return Frame(
        id=id,
        ts=now(),
        kind=Kind.DATA,
        op=op,
        payload=payload,
        **kw
    )

def make_meta(id: int, op: Op, payload: dict, **kw) -> Frame:
    return Frame(
        id=id,
        ts=now(),
        kind=Kind.META,
        op=op,
        payload=payload,
        **kw
    )

def make_error(id: int, code: str, message: str, http: int|None=None, ws_close: int|None=None, details: dict|None=None, **kw) -> Frame:
    return Frame(
        id=id,
        ts=now(),
        kind=Kind.ERROR,
        op=Op.ERROR,
        error=ErrorInfo(code=code, http=http, ws_close=ws_close, message=message, details=details),
        **kw
    )

def make_done(id: int, payload: dict | None = None, **kw) -> Frame:
    return Frame(
        id=id,
        ts=now(),
        kind=Kind.META,
        op=Op.DONE,
        payload=payload,
        **kw
    )