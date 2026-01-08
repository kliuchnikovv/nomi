from enum import Enum
from typing import Any, Dict, Optional, Literal
from pydantic import BaseModel, Field
from datetime import datetime

class Kind(str, Enum):
    DATA = "data"
    META = "meta"
    ERROR = "error"
    SIGNAL = "signal"

class Op(str, Enum):
    MESSAGE = "message"
    ACK = "ack"
    NACK = "nack"
    JOIN = "join"
    LEAVE = "leave"
    PING = "ping"
    PONG = "pong"
    ERROR = "error"
    DONE = "done"
    TOOLS = "tools"
    HISTORY = "history"
    MODEL = "model"
    STOP = "stop"
    SIGNAL = "signal"

class StreamInfo(BaseModel):
    id: str
    ix: int = Field(ge=0)         # порядковый номер чанка
    eof: bool = False             # последний ли чанк

class ErrorInfo(BaseModel):
    code: str                     # машинно-читабельный код
    http: Optional[int] = None    # сопоставление с HTTP
    ws_close: Optional[int] = None# сопоставление с WS close code
    message: str
    details: Optional[Dict[str, Any]] = None

class Frame(BaseModel):
    v: Literal["1"] = "1"
    id: int
    ts: datetime
    kind: Kind
    op: Op
    chat_id: Optional[str] = None
    message_id: Optional[str] = None
    channel: Optional[str] = None
    corr_id: Optional[str] = None
    seq: Optional[int] = Field(default=None, ge=0)
    stream: Optional[StreamInfo] = None
    headers: Dict[str, Any] = {}
    payload: Optional[Dict[str, Any]] = None
    error: Optional[ErrorInfo] = None

    # Небольшая инвариантная валидация
    def validate_invariants(self) -> None:
        if self.kind == Kind.ERROR:
            assert self.error is not None, "error must be set for kind=error"
        else:
            assert self.payload is not None, "payload must be set for non-error"

    # Унифицированная сериализация для отправки через WS
    def marshal(self) -> Dict[str, Any]:
        # pydantic v2
        if hasattr(self, "model_dump"):
            try:
                return self.model_dump(mode="json")
            except TypeError:
                # Older pydantic v2 without mode kw
                return self.model_dump()
        # pydantic v1 fallback: ensure datetimes are JSON serializable
        try:
            import json as _json
            return _json.loads(self.json())
        except Exception:
            return self.dict()
