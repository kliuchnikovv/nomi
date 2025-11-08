package streamer

import (
	"time"

	"github.com/google/uuid"
)

type Kind string

const (
	TokenKind Kind = "data"
	MetaKind  Kind = "meta"
	ErrorKind Kind = "error"
)

type Operation string

const (
	MessageOperation Operation = "message"
	AckOperation     Operation = "ack"
	NackOperation    Operation = "nack"
	JoinOperation    Operation = "join"
	LeaveOperation   Operation = "leave"
	PingOperation    Operation = "ping"
	PongOperation    Operation = "pong"
	ErrorOperation   Operation = "error"
	DoneOperation    Operation = "done"
)

type Frame struct {
	ID        int       `json:"id"`
	Timestamp time.Time `json:"ts"`
	Kind      Kind      `json:"kind"`
	Channel   string    `json:"channel"`
	Operation Operation `json:"op"`
	Payload   Payload   `json:"payload"`
	Error     ErrorInfo `json:"error"`
}

type Payload struct {
	MessageID   uuid.UUID `json:"message_id,omitempty"`
	Message     string    `json:"message,omitempty"`
	Reason      string    `json:"reason,omitempty"`
	Kind        Kind      `json:"kind,omitempty"`
	Index       uint      `json:"ix,omitempty"`
	EndOfBuffer bool      `json:"eof,omitempty"`

	Type             string `json:"type,omitempty"`
	PromptTokens     uint   `json:"prompt_tokens,omitempty"`
	CompletionTokens uint   `json:"completion_tokens,omitempty"`
	ElapsedMS        uint   `json:"elapsed_ms,omitempty"`
}

type ErrorInfo struct {
	Code     string `json:"code"`
	CodeHTTP int    `json:"http"`
	Message  string `json:"message"`
	Details  any    `json:"details"`
}
