package hub

import (
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
)

// PayloadType defines the type of payload in the frame
type PayloadType string

const (
	PayloadTypeText           PayloadType = "text"
	PayloadTypeToolCall       PayloadType = "tool_call"
	PayloadTypeReasoning      PayloadType = "reasoning"
	PayloadTypeMemberResponse PayloadType = "member_response"
	PayloadTypeMetadata       PayloadType = "metadata"
	PayloadTypeActions        PayloadType = "actions"
	PayloadTypeError          PayloadType = "error"
	PayloadTypeChatUpdate     PayloadType = "chat_update"
	PayloadTypeClientAction   PayloadType = "client_action"
)

// BasePayload fields common to all payloads (embedded where possible or used for composition)
type BasePayload struct {
	Type      PayloadType `json:"type"`
	MessageID uuid.UUID   `json:"message_id,omitempty"`
	TraceID   string      `json:"trace_id,omitempty"`
}

// TextPayload carries text deltas
type TextPayload struct {
	Type      PayloadType `json:"type"`
	MessageID uuid.UUID   `json:"message_id"`
	TraceID   string      `json:"trace_id,omitempty"`
	Delta     string      `json:"delta,omitempty"`
	Message   string      `json:"message,omitempty"` // Fallback for legacy backend
}

// ToolCallPayload carries tool call information
type ToolCallPayload struct {
	Type      PayloadType   `json:"type"`
	MessageID uuid.UUID     `json:"message_id"`
	TraceID   string        `json:"trace_id,omitempty"`
	ToolCall  chat.ToolCall `json:"tool"`
}

// ReasoningPayload carries reasoning/thinking deltas
type ReasoningPayload struct {
	Type      PayloadType `json:"type"`
	MessageID uuid.UUID   `json:"message_id"`
	TraceID   string      `json:"trace_id,omitempty"`
	Delta     string      `json:"delta,omitempty"`
	Content   string      `json:"content,omitempty"` // Fallback for legacy backend
}

// MemberResponsePayload carries team member responses
type MemberResponsePayload struct {
	Type      PayloadType `json:"type"`
	MessageID uuid.UUID   `json:"message_id"`
	TraceID   string      `json:"trace_id,omitempty"`
	AgentName string      `json:"agent_name"`
	Delta     string      `json:"delta,omitempty"`
	Message   string      `json:"message,omitempty"` // Fallback
}

// MetadataPayload carries message metadata (model, full tool calls list, etc)
type MetadataPayload struct {
	Type      PayloadType     `json:"type"`
	MessageID uuid.UUID       `json:"message_id"`
	TraceID   string          `json:"trace_id,omitempty"`
	Model     string          `json:"model,omitempty"`
	ToolCalls []chat.ToolCall `json:"tool_calls,omitempty"`
}

// ActionsPayload carries suggested actions (e.g. for UI buttons)
type ActionsPayload struct {
	Type      PayloadType   `json:"type"`
	MessageID uuid.UUID     `json:"message_id"`
	TraceID   string        `json:"trace_id,omitempty"`
	Actions   []chat.Action `json:"actions"`
}

// ChatUpdatePayload carries updates about the chat (e.g. title change)
type ChatUpdatePayload struct {
	Type    PayloadType `json:"type"`
	TraceID string      `json:"trace_id,omitempty"`
	Message string      `json:"message"` // Used for title
}

// ClientActionPayload carries requests for client-side tool execution
type ClientActionPayload struct {
	Type        PayloadType            `json:"type"`
	TraceID     string                 `json:"trace_id,omitempty"`
	Method      string                 `json:"method"`
	Params      map[string]interface{} `json:"params"`
	Description string                 `json:"description,omitempty"`
	Tool        string                 `json:"tool,omitempty"` // e.g. "gmail", "calendar"
}

// UserMessagePayload represents a message sent by the user
type UserMessagePayload struct {
	MessageID     uuid.UUID   `json:"message_id,omitempty"`
	TraceID       string      `json:"trace_id,omitempty"`
	Message       string      `json:"message"`
	Role          string      `json:"role,omitempty"`
	Model         string      `json:"model,omitempty"`
	Provider      string      `json:"provider,omitempty"`
	Endpoint      string      `json:"endpoint,omitempty"`
	AttachmentIDs []uuid.UUID `json:"attachment_ids,omitempty"`
	Attachments   interface{} `json:"attachments,omitempty"`
	WebSearch     bool        `json:"web_search,omitempty"`

	// Command/Team specific
	Command   chat.Command `json:"command,omitempty"`
	Team      interface{}  `json:"team,omitempty"`
	AgentType string       `json:"agent_type,omitempty"`
	Tools     interface{}  `json:"tools,omitempty"` // User-provided tools/integrations
	UserID    uuid.UUID    `json:"user_id,omitempty"`
}
