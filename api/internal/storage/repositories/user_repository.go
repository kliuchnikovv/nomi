package repositories

import (
	"context"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// UserRepository defines interface for user operations
type UserRepository interface {
	CreateUser(ctx context.Context, email, password, name string) (*storage.User, error)
	GetUserByEmail(ctx context.Context, email string) (*storage.User, error)
	GetUserByID(ctx context.Context, id uuid.UUID) (*storage.User, error)
	UpdateUser(ctx context.Context, user *storage.User) error
}

// NewUserRepository creates a new user repository
func NewUserRepository(store *storage.Storage) UserRepository {
	return &userRepository{store: store}
}

// userRepository implements UserRepository interface
type userRepository struct {
	store *storage.Storage
}

// CreateUser creates a new user
func (r *userRepository) CreateUser(ctx context.Context, email, password, name string) (*storage.User, error) {
	return r.store.CreateUser(ctx, email, password, name)
}

// GetUserByEmail gets user by email
func (r *userRepository) GetUserByEmail(ctx context.Context, email string) (*storage.User, error) {
	return r.store.GetUserByEmail(ctx, email)
}

// GetUserByID gets user by ID
func (r *userRepository) GetUserByID(ctx context.Context, id uuid.UUID) (*storage.User, error) {
	return r.store.GetUserByID(ctx, id)
}

// UpdateUser updates user data
func (r *userRepository) UpdateUser(ctx context.Context, user *storage.User) error {
	return r.store.UpdateUser(ctx, user)
}
