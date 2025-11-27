package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

type OAuthToken struct {
	ID             uuid.UUID      `gorm:"type:uuid;primaryKey"`
	UserID         uuid.UUID      `gorm:"type:uuid;index"`
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

func (s *Storage) SaveOAuthToken(ctx context.Context, token *OAuthToken) error {
	now := time.Now().UTC()
	if token.ID == uuid.Nil {
		token.ID = uuid.New()
		token.CreatedAt = now
	}
	token.UpdatedAt = now
	return s.DB.WithContext(ctx).Create(token).Error
}

func (s *Storage) UpdateOAuthToken(ctx context.Context, token *OAuthToken) error {
	token.UpdatedAt = time.Now().UTC()
	token.Version++
	return s.DB.WithContext(ctx).Save(token).Error
}

func (s *Storage) GetOAuthTokenByUser(ctx context.Context, userID uuid.UUID, provider string) (*OAuthToken, error) {
	var token OAuthToken
	if err := s.DB.WithContext(ctx).
		Where("user_id = ? AND provider = ? AND deleted_at IS NULL", userID, provider).
		First(&token).Error; err != nil {
		return nil, err
	}
	return &token, nil
}

func (s *Storage) DeleteOAuthTokenByProfileProvider(ctx context.Context, profileID, provider string) error {
	return s.DB.WithContext(ctx).
		Where("profile_id = ? AND provider = ?", profileID, provider).
		Delete(&OAuthToken{}).Error
}
