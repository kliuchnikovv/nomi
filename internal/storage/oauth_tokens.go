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

// GetOAuthTokenByProfileProvider finds the latest token for profile+provider
func (s *Storage) GetOAuthTokenByProfileProvider(profileID, provider string) (*OAuthToken, error) {
	var t OAuthToken
	if err := s.DB.Where("profile_id = ? AND provider = ? AND deleted_at IS NULL", profileID, provider).First(&t).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

// UpdateOAuthToken updates the token record (save merged fields)
func (s *Storage) UpdateOAuthToken(token *OAuthToken) error {
	token.UpdatedAt = time.Now()
	return s.DB.Save(token).Error
}

// DeleteOAuthTokenByProfileProvider deletes (soft-delete) token by profile and provider
func (s *Storage) DeleteOAuthTokenByProfileProvider(profileID, provider string) error {
	return s.DB.Where("profile_id = ? AND provider = ?", profileID, provider).Delete(&OAuthToken{}).Error
}
