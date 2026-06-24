from enum import Enum
from typing import Any, Literal
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
    TASK_START = "task_start"
    COMMAND_CALL = "command_call"
    SESSION_STATE = "session_state"


class StreamInfo(BaseModel):
    id: str
    ix: int = Field(ge=0)  # chunk index number
    eof: bool = False  # last chunk flag


class ErrorInfo(BaseModel):
    code: str  # machine-readable code
    http: int | None = None  # HTTP mapping
    ws_close: int | None = None  # WebSocket close code mapping
    message: str
    details: dict[str, Any] | None = None


class ClientToolResult(BaseModel):
    """Structured result from client tool execution."""

    status: Literal["success", "error", "timeout"]
    result: str | None = None
    error_code: str | None = (
        None  # "timeout", "device_offline", "execution_error", "no_integration"
    )
    error_details: dict[str, Any] | None = None
    latency_ms: int | None = None
    call_id: str | None = None


class Frame(BaseModel):
    v: Literal["1"] = "1"
    id: int
    ts: datetime
    kind: Kind
    op: Op
    chat_id: str | None = None
    trace_id: str | None = None
    message_id: str | None = None
    channel: str | None = None
    corr_id: str | None = None
    seq: int | None = Field(default=None, ge=0)
    stream: StreamInfo | None = None
    headers: dict[str, Any] = {}
    payload: dict[str, Any] | None = None
    error: ErrorInfo | None = None

    # Invariant validation
    def validate_invariants(self) -> None:
        if self.kind == Kind.ERROR:
            assert self.error is not None, "error must be set for kind=error"
        else:
            assert self.payload is not None, "payload must be set for non-error"

    # Unified serialization for sending over WS
    def marshal(self) -> dict[str, Any]:
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
