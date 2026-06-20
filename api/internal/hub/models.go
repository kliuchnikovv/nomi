package hub

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type Kind string

const (
	TokenKind  Kind = "data"
	MetaKind   Kind = "meta"
	ErrorKind  Kind = "error"
	SignalKind Kind = "signal"
)

type Operation string

const (
	ErrorOperation      Operation = "error"
	MessageOperation    Operation = "message"
	DoneOperation       Operation = "done"
	SignalOperation     Operation = "signal"
	StoreFactsOperation Operation = "store_facts"
	StopOperation       Operation = "stop"
)

type Frame struct {
	ID        int             `json:"id"`
	ChatID    uuid.UUID       `json:"chat_id"`
	TraceID   string          `json:"trace_id,omitempty"`
	Timestamp time.Time       `json:"ts"`
	Kind      Kind            `json:"kind"`
	Channel   string          `json:"channel"`
	Operation Operation       `json:"op"`
	Payload   json.RawMessage `json:"payload"`
	Error     ErrorInfo       `json:"error"`
}

// Payload struct removed in favor of typed payloads in payloads.go

type ErrorInfo struct {
	Code     string `json:"code"`
	CodeHTTP int    `json:"http"`
	Message  string `json:"message"`
	Details  any    `json:"details"`
}

// Error codes for structured error handling
const (
	ErrorCodeParseFailed      = "parse_failed"
	ErrorCodeSaveFailed       = "save_failed"
	ErrorCodeRedisFailed      = "redis_failed"
	ErrorCodeMarshalFailed    = "marshal_failed"
	ErrorCodeDispatchFailed   = "dispatch_failed"
	ErrorCodeAttachmentFailed = "attachment_failed"
	ErrorCodeWebSocketClosed  = "websocket_closed"
	ErrorCodeAgentFailed      = "agent_failed"
	ErrorCodeTaskFailed       = "task_failed"
	ErrorCodeWorkerError      = "worker_error"
	ErrorCodeTimeout          = "timeout"
)
