package storage

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

type OAuthToken struct {
	ID             uuid.UUID      `gorm:"type:uuid;primaryKey"`
	ProfileID      string         `gorm:"index;type:text"`
	Provider       string         `gorm:"type:text"`
	AccountEmail   string         `gorm:"type:text"`
	ExternalUserID string         `gorm:"type:text"`
	Scopes         pq.StringArray `gorm:"type:text[]"`
	TokenEncrypted []byte         `gorm:"type:bytea"`
	CreatedAt      time.Time
	UpdatedAt      time.Time
	Version        int            `gorm:"default:1"`
	DeletedAt      gorm.DeletedAt `gorm:"index"`
}

func (OAuthToken) TableName() string {
	return "oauth_tokens"
}

func (s *Storage) SaveOAuthToken(token *OAuthToken) error {
	if token.ID == uuid.Nil {
		token.ID = uuid.New()
	}
	return s.DB.Create(token).Error
}
