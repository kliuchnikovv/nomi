package domain

import (
	"context"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// UserRepository определяет интерфейс для работы с пользователями
type UserRepository interface {
	// CreateUser создает нового пользователя
	CreateUser(ctx context.Context, email, password, name string) (*storage.User, error)

	// GetUserByEmail получает пользователя по email
	GetUserByEmail(ctx context.Context, email string) (*storage.User, error)

	// GetUserByID получает пользователя по ID
	GetUserByID(ctx context.Context, id uuid.UUID) (*storage.User, error)

	// UpdateUser обновляет данные пользователя
	UpdateUser(ctx context.Context, user *storage.User) error
}
