package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type MockStorage struct {
	*Storage
	GetUserByEmailFunc   func(ctx context.Context, email string) (*User, error)
	SaveRefreshTokenFunc func(ctx context.Context, userID uuid.UUID, token string, ttl time.Duration) error
}

func (m *MockStorage) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	return m.GetUserByEmailFunc(ctx, email)
}

func (m *MockStorage) SaveRefreshToken(ctx context.Context, userID uuid.UUID, token string, ttl time.Duration) error {
	return m.SaveRefreshTokenFunc(ctx, userID, token, ttl)
}
