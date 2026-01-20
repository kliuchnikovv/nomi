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
	PingOperation        Operation = "ping"
	ErrorOperation       Operation = "error"
	MessageOperation     Operation = "message"
	DoneOperation        Operation = "done"
	ToolsOperation       Operation = "tools"
	HistoryOperation     Operation = "history"
	SelectModelOperation Operation = "select_model"
	ChangeModelOperation Operation = "change_model"

	AckOperation    Operation = "ack"
	NackOperation   Operation = "nack"
	JoinOperation   Operation = "join"
	LeaveOperation  Operation = "leave"
	PongOperation   Operation = "pong"
	SignalOperation Operation = "signal"
)

type Frame struct {
	ID        int             `json:"id"`
	ChatID    uuid.UUID       `json:"chat_id"`
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
