package chat

import (
	"time"

	"github.com/google/uuid"
)

type Chat struct {
	ID         uuid.UUID  `json:"id"`
	Model      string     `json:"model"`
	Title      string     `json:"title"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	ArchivedAt *time.Time `json:"archived_at"`
	DeletedAt  *time.Time `json:"deleted_at"`
}

type Role string

const (
	RoleUser      Role = "user"
	RoleSystem    Role = "system"
	RoleAssistant Role = "assistant"
)

type Message struct {
	ID        uuid.UUID   `json:"id"`
	ChatID    uuid.UUID   `json:"chat_id"`
	Sender    uuid.UUID   `json:"sender"`
	Role      Role        `json:"role"`
	Text      string      `json:"text"`
	ToolCalls interface{} `json:"tool_calls,omitempty"`
	Model     string      `json:"model,omitempty"`
	CreatedAt time.Time   `json:"created_at"`
}
