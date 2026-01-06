package storage

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

// WebhookEvent represents a GitHub webhook event
type WebhookEvent struct {
	ID           uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	Source       string         `gorm:"type:varchar(50);not null;index"` // "github"
	EventType    string         `gorm:"type:varchar(50);not null;index"` // "pull_request"
	Action       string         `gorm:"type:varchar(50);not null"`       // "opened", "synchronize"
	RepoFullName string         `gorm:"type:text;not null;index"`        // "kliuchnikovv/genie-api"
	PRNumber     int            `gorm:"type:integer"`
	PRTitle      string         `gorm:"type:text"`
	PRURL        string         `gorm:"type:text"`
	DiffURL      string         `gorm:"type:text"`
	Sender       string         `gorm:"type:varchar(100)"`                  // "jules-bot"
	Status       string         `gorm:"type:varchar(20);default:'pending'"` // pending, processing, reviewed
	Payload      datatypes.JSON `gorm:"type:jsonb"`                         // Raw payload for debugging
	ReviewResult datatypes.JSON `gorm:"type:jsonb"`                         // AI review result (Stage 2)
	CreatedAt    time.Time      `gorm:"not null"`
	ProcessedAt  *time.Time     `gorm:"default:null"`
}
