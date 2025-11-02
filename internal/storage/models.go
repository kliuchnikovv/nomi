package storage

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ChatModel представляет чат в базе данных
type ChatModel struct {
	ID         uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID     uuid.UUID  `gorm:"type:uuid;not null"`
	Model      uuid.UUID  `gorm:"type:uuid;not null"`
	Title      string     `gorm:"not null"`
	CreatedAt  time.Time  `gorm:"not null"`
	UpdatedAt  time.Time  `gorm:"not null"`
	ArchivedAt *time.Time `gorm:"default:null"`
	DeletedAt  gorm.DeletedAt
}

// MessageModel представляет сообщение в базе данных
type MessageModel struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	ChatID    uuid.UUID `gorm:"type:uuid;not null"`
	UserID    uuid.UUID `gorm:"type:uuid;not null"`
	Role      string    `gorm:"type:varchar(20);not null"`
	Text      string    `gorm:"type:text;not null"`
	CreatedAt time.Time `gorm:"not null"`
	UpdatedAt time.Time `gorm:"not null"`
}
