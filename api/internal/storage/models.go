package storage

import (
	"context"
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

// Attachment represents a file attachment in the database
type Attachment struct {
	ID        uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	MessageID *uuid.UUID `gorm:"type:uuid;index;default:null"` // Nullable, linked when message is sent
	UserID    uuid.UUID  `gorm:"type:uuid;not null;index"`
	FileName  string     `gorm:"type:text;not null"`
	FileType  string     `gorm:"type:text;not null"`
	Size      int64      `gorm:"type:bigint;not null"`
	Content   []byte     `gorm:"type:bytea;not null"` // Store content directly in DB
	CreatedAt time.Time  `gorm:"not null"`
}

// Message represents a message in the database
type Message struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	ChatID      uuid.UUID      `gorm:"type:uuid;not null"`
	UserID      uuid.UUID      `gorm:"type:uuid;not null"`
	Role        string         `gorm:"type:varchar(20);not null"`
	Text        string         `gorm:"type:text;not null"`
	ToolCalls   datatypes.JSON `gorm:"type:jsonb"`
	Reasoning   string         `gorm:"type:text"` // Stores accumulated reasoning/thinking steps
	Model       string         `gorm:"type:text"`
	Attachments []Attachment   `gorm:"foreignKey:MessageID"`
	CreatedAt   time.Time      `gorm:"not null"`
	UpdatedAt   time.Time      `gorm:"not null"`
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

// CreateAttachment creates a new attachment record
func (s *Storage) CreateAttachment(ctx context.Context, attachment *Attachment) error {
	return s.DB.WithContext(ctx).Create(attachment).Error
}

// GetAttachmentsByIDs retrieves attachments by their IDs
func (s *Storage) GetAttachment(ctx context.Context, id uuid.UUID) (*Attachment, error) {
	var attachment Attachment
	if err := s.DB.WithContext(ctx).First(&attachment, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &attachment, nil
}

func (s *Storage) GetAttachmentsByIDs(ctx context.Context, ids []uuid.UUID) ([]Attachment, error) {
	var attachments []Attachment
	if err := s.DB.WithContext(ctx).Where("id IN ?", ids).Find(&attachments).Error; err != nil {
		return nil, err
	}
	return attachments, nil
}
