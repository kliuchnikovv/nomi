package repositories

import (
	"context"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/domain"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// userRepository реализует domain.UserRepository используя storage.Storage
type userRepository struct {
	storage *storage.Storage
}

// NewUserRepository создает новый экземпляр UserRepository
func NewUserRepository(s *storage.Storage) domain.UserRepository {
	return &userRepository{
		storage: s,
	}
}

func (r *userRepository) CreateUser(ctx context.Context, email, password, name string) (*storage.User, error) {
	return r.storage.CreateUser(ctx, email, password, name)
}

func (r *userRepository) GetUserByEmail(ctx context.Context, email string) (*storage.User, error) {
	return r.storage.GetUserByEmail(ctx, email)
}

func (r *userRepository) GetUserByID(ctx context.Context, id uuid.UUID) (*storage.User, error) {
	return r.storage.GetUserByID(ctx, id)
}

func (r *userRepository) UpdateUser(ctx context.Context, user *storage.User) error {
	return r.storage.UpdateUser(ctx, user)
}
