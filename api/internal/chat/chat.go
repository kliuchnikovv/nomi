package chat

import (
	"time"

	"github.com/google/uuid"
)

type Chat struct {
	ID         uuid.UUID  `json:"id"`
	Model      string     `json:"model"`
	Title      string     `json:"title"`
	Mode       string     `json:"mode"`              // 'agent' or 'team'
	TeamID     *string    `json:"team_id,omitempty"` // null for agent mode
	Icon       string     `json:"icon,omitempty"`    // Icon name provided by backend
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

type Attachment struct {
	ID       uuid.UUID `json:"id"`
	FileName string    `json:"file_name"`
	FileType string    `json:"file_type"`
	Size     int64     `json:"size"`
	Content  string    `json:"content,omitempty"` // Base64 encoded content
}

type Message struct {
	ID            uuid.UUID     `json:"id"`
	ChatID        uuid.UUID     `json:"chat_id"`
	Sender        uuid.UUID     `json:"sender"`
	Role          Role          `json:"role"`
	Text          string        `json:"text"`
	AgentID       *string       `json:"agent_id,omitempty"` // For multi-agent teams
	ToolCalls     []ToolCall    `json:"tool_calls,omitempty"`
	ContentParts  []ContentPart `json:"content_parts,omitempty"`
	Reasoning     string        `json:"reasoning,omitempty"`
	Model         string        `json:"model,omitempty"`
	Actions       []Action      `json:"actions,omitempty"`        // D&D action buttons
	Attachments   []Attachment  `json:"attachments,omitempty"`    // For reading
	AttachmentIDs []uuid.UUID   `json:"attachment_ids,omitempty"` // For writing
	WebSearch     bool          `json:"web_search,omitempty"`     // For writing
	ContextItems  interface{}   `json:"context_items,omitempty"`  // Context items (emails, documents, etc.)
	CreatedAt     time.Time     `json:"created_at"`
}
