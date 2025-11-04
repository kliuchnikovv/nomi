package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/google/uuid"
)

type RefreshToken struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;index"`
	TokenHash string    `gorm:"type:char(64);uniqueIndex;not null"`
	ExpiresAt time.Time `gorm:"not null;index"`
	RevokedAt *time.Time
	CreatedAt time.Time
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// SaveRefreshToken stores a new refresh token record with TTL seconds from now.
func (s *Storage) SaveRefreshToken(ctx context.Context, userID uuid.UUID, token string, ttl time.Duration) error {
	rt := &RefreshToken{
		UserID:    userID,
		TokenHash: hashToken(token),
		ExpiresAt: time.Now().Add(ttl),
		CreatedAt: time.Now(),
	}
	return s.DB.WithContext(ctx).Create(rt).Error
}

// ConsumeRefreshToken validates and revokes a refresh token (rotation).
func (s *Storage) ConsumeRefreshToken(ctx context.Context, token string) (*RefreshToken, error) {
	var rt RefreshToken
	err := s.DB.WithContext(ctx).Where("token_hash = ?", hashToken(token)).First(&rt).Error
	if err != nil {
		return nil, err
	}
	if rt.RevokedAt != nil || time.Now().After(rt.ExpiresAt) {
		return nil, errors.New("refresh token invalid")
	}
	now := time.Now()
	if err := s.DB.WithContext(ctx).Model(&rt).Update("revoked_at", &now).Error; err != nil {
		return nil, err
	}
	return &rt, nil
}
