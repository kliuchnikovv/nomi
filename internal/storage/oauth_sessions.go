package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type OAuthSession struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;index"`
	Provider  string    `gorm:"type:text;not null"`
	State     string    `gorm:"type:text;not null"`
	ExpiresAt time.Time `gorm:"not null"`
	CreatedAt time.Time `gorm:"not null"`
}

func (s *Storage) CreateOAuthSession(ctx context.Context, session *OAuthSession) error {
	if session.ID == uuid.Nil {
		session.ID = uuid.New()
	}
	session.CreatedAt = time.Now().UTC()
	return s.DB.WithContext(ctx).Create(session).Error
}

func (s *Storage) GetOAuthSession(ctx context.Context, id uuid.UUID) (*OAuthSession, error) {
	var session OAuthSession
	if err := s.DB.WithContext(ctx).First(&session, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

func (s *Storage) DeleteOAuthSession(ctx context.Context, id uuid.UUID) error {
	return s.DB.WithContext(ctx).Delete(&OAuthSession{}, "id = ?", id).Error
}
