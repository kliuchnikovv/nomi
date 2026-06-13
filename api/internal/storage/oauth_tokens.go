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

	var existing OAuthToken
	err := s.DB.WithContext(ctx).
		Where("user_id = ? AND provider = ? AND account_email = ? AND deleted_at IS NULL",
			token.UserID, token.Provider, token.AccountEmail).
		First(&existing).Error

	if err == nil {
		existing.TokenEncrypted = token.TokenEncrypted
		existing.Scopes = token.Scopes
		existing.ExternalUserID = token.ExternalUserID
		existing.UpdatedAt = now
		existing.Version++
		return s.DB.WithContext(ctx).Save(&existing).Error
	}

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

// GetOAuthTokenByUserAndEmail returns a token for a specific account email (for multi-account setups).
func (s *Storage) GetOAuthTokenByUserAndEmail(ctx context.Context, userID uuid.UUID, provider, accountEmail string) (*OAuthToken, error) {
	var token OAuthToken
	if err := s.DB.WithContext(ctx).
		Where("user_id = ? AND provider = ? AND account_email = ? AND deleted_at IS NULL", userID, provider, accountEmail).
		First(&token).Error; err != nil {
		return nil, err
	}
	return &token, nil
}

// ListOAuthTokensByUser returns all tokens for a given provider for a user.
func (s *Storage) ListOAuthTokensByUser(ctx context.Context, userID uuid.UUID, provider string) ([]OAuthToken, error) {
	var tokens []OAuthToken
	if err := s.DB.WithContext(ctx).
		Where("user_id = ? AND provider = ? AND deleted_at IS NULL", userID, provider).
		Find(&tokens).Error; err != nil {
		return nil, err
	}
	return tokens, nil
}

func (s *Storage) DeleteOAuthTokenByProfileProvider(ctx context.Context, profileID, provider string) error {
	return s.DB.WithContext(ctx).
		Where("profile_id = ? AND provider = ?", profileID, provider).
		Delete(&OAuthToken{}).Error
}

// DeleteOAuthTokenByUserAndEmail hard-deletes the credential for a user's
// integration. Called when an integration is disconnected so the token doesn't
// linger (a reconnect would otherwise create a second row, since SaveOAuthToken
// only matches deleted_at IS NULL). When accountEmail is empty, all tokens for
// the provider are removed.
func (s *Storage) DeleteOAuthTokenByUserAndEmail(ctx context.Context, userID uuid.UUID, provider, accountEmail string) error {
	q := s.DB.WithContext(ctx).Unscoped().
		Where("user_id = ? AND provider = ?", userID, provider)
	if accountEmail != "" {
		q = q.Where("account_email = ?", accountEmail)
	}
	return q.Delete(&OAuthToken{}).Error
}
