package hub

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
	PingOperation        Operation = "ping"
	ErrorOperation       Operation = "error"
	MessageOperation     Operation = "message"
	DoneOperation        Operation = "done"
	ToolsOperation       Operation = "tools"
	HistoryOperation     Operation = "history"
	SelectModelOperation Operation = "select_model"
	ChangeModelOperation Operation = "change_model"

	AckOperation   Operation = "ack"
	NackOperation  Operation = "nack"
	JoinOperation  Operation = "join"
	LeaveOperation Operation = "leave"
	PongOperation  Operation = "pong"
)

type Frame struct {
	ID        int       `json:"id"`
	ChatID    uuid.UUID `json:"chat_id"`
	Timestamp time.Time `json:"ts"`
	Kind      Kind      `json:"kind"`
	Channel   string    `json:"channel"`
	Operation Operation `json:"op"`
	Payload   Payload   `json:"payload"`
	Error     ErrorInfo `json:"error"`
}

type Payload struct {
	MessageID   uuid.UUID   `json:"message_id,omitempty"`
	Message     string      `json:"message,omitempty"`
	Model       string      `json:"model,omitempty"`
	ToolCalls   interface{} `json:"tool_calls,omitempty"`
	Reason      string      `json:"reason,omitempty"`
	Index       uint        `json:"ix,omitempty"`
	EndOfBuffer bool        `json:"eof,omitempty"`

	// Role and Sender for multi-device sync (to distinguish user/assistant messages)
	Role   string    `json:"role,omitempty"`   // "user" or "assistant"
	Sender uuid.UUID `json:"sender,omitempty"` // User ID who sent the message

	Type             string      `json:"type,omitempty"`
	CompletionTokens uint        `json:"completion_tokens,omitempty"`
	ElapsedMS        uint        `json:"elapsed_ms,omitempty"`
	Tools            interface{} `json:"tools,omitempty"`
	History          interface{} `json:"history,omitempty"`
	Attachments      interface{} `json:"attachments,omitempty"`
	AttachmentIDs    []uuid.UUID `json:"attachment_ids,omitempty"`
	WebSearch        bool        `json:"web_search,omitempty"`

	// Command/Team specific
	Command interface{} `json:"command,omitempty"`
	Team    interface{} `json:"team,omitempty"`
}

type ErrorInfo struct {
	Code     string `json:"code"`
	CodeHTTP int    `json:"http"`
	Message  string `json:"message"`
	Details  any    `json:"details"`
}
