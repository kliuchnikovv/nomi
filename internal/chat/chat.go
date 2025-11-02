package chat

import (
	"time"

	"github.com/google/uuid"
)

type Chat struct {
	ID         uuid.UUID
	Model      uuid.UUID
	Title      string
	CreatedAt  time.Time
	UpdatedAt  time.Time
	ArchivedAt *time.Time
	DeletedAt  *time.Time
}

type Role string

const (
	RoleUser      Role = "user"
	RoleSystem    Role = "system"
	RoleAssistant Role = "assistant"
)

type Message struct {
	ChatID uuid.UUID
	Sender uuid.UUID
	Role   Role
	Text   string
}
