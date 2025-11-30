package storage

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// Chat представляет чат в базе данных
type Chat struct {
	ID         uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID     uuid.UUID  `gorm:"type:uuid;not null"`
	Model      string     `gorm:"type:text;not null"`
	Title      string     `gorm:"not null"`
	CreatedAt  time.Time  `gorm:"not null"`
	UpdatedAt  time.Time  `gorm:"not null"`
	ArchivedAt *time.Time `gorm:"default:null"`
	DeletedAt  gorm.DeletedAt
}

// Message представляет сообщение в базе данных
type Message struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	ChatID    uuid.UUID `gorm:"type:uuid;not null"`
	UserID    uuid.UUID `gorm:"type:uuid;not null"`
	Role      string    `gorm:"type:varchar(20);not null"`
	Text      string    `gorm:"type:text;not null"`
	CreatedAt time.Time `gorm:"not null"`
	UpdatedAt time.Time `gorm:"not null"`
}

type Integration struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID    uuid.UUID `gorm:"type:uuid;not null"`
	Name      string    `gorm:"type:text;not null"`
	Provider  string    `gorm:"type:text;not null"`
	Params    string    `gorm:"type:text;not null"`
	Enabled   bool      `gorm:"default:true;not null"`
	CreatedAt time.Time `gorm:"not null"`
	UpdatedAt time.Time `gorm:"not null"`
}

type Inbox struct {
	ID            uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID        uuid.UUID      `gorm:"type:uuid;not null"`
	IntegrationID uuid.UUID      `gorm:"type:uuid;not null"`
	Source        string         `gorm:"type:varchar(50);not null;default:'gmail'"`
	MessageID     string         `gorm:"type:text"`
	UID           uint32         `gorm:"type:integer"`
	ThreadID      uint64         `gorm:"type:bigint"`
	Sender        string         `gorm:"type:text"`
	Role          string         `gorm:"type:varchar(20);not null;default:'user'"`
	Header        string         `gorm:"type:text;not null"`
	Content       string         `gorm:"type:text;not null"`
	Summary       string         `gorm:"type:text"`
	Importance    string         `gorm:"type:varchar(50)"`
	Actions       datatypes.JSON `gorm:"type:jsonb"`
	Metadata      datatypes.JSON `gorm:"type:jsonb"`
	Status        string         `gorm:"type:varchar(20);default:'pending';not null"`
	ReceivedAt    time.Time      `gorm:"not null"`
	CreatedAt     time.Time      `gorm:"not null"`
	UpdatedAt     time.Time      `gorm:"not null"`
}
