package repositories

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// MessageRepository defines interface for message operations
type MessageRepository interface {
	Create(ctx context.Context, userID uuid.UUID, m *chat.Message) (*chat.Message, error)
	Get(ctx context.Context, userID uuid.UUID, messageID uuid.UUID) (*chat.Message, error)
	GetMessages(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, limit ...int) ([]*chat.Message, error)
	GetMessagesAfter(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, since time.Time) ([]*chat.Message, error)
	Upsert(ctx context.Context, userID uuid.UUID, m *chat.Message) error
}

// NewMessageRepository creates a new message repository
func NewMessageRepository(store *storage.Storage) MessageRepository {
	return &messageRepository{store: store}
}

// messageRepository implements MessageRepository interface
type messageRepository struct {
	store *storage.Storage
}

// Create creates a new message
func (r *messageRepository) Create(ctx context.Context, userID uuid.UUID, m *chat.Message) (*chat.Message, error) {
	return r.store.CreateMessage(ctx, userID, m)
}

// Get gets a message by ID
func (r *messageRepository) Get(ctx context.Context, userID uuid.UUID, messageID uuid.UUID) (*chat.Message, error) {
	return r.store.GetMessage(ctx, userID, messageID)
}

// GetMessages gets messages for a chat
func (r *messageRepository) GetMessages(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, limit ...int) ([]*chat.Message, error) {
	return r.store.GetMessages(ctx, userID, chatID, limit...)
}

// GetMessagesAfter gets messages created after a specific time
func (r *messageRepository) GetMessagesAfter(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, since time.Time) ([]*chat.Message, error) {
	return r.store.GetMessagesAfter(ctx, userID, chatID, since)
}

// Upsert updates or creates a message
func (r *messageRepository) Upsert(ctx context.Context, userID uuid.UUID, m *chat.Message) error {
	return r.store.UpsertMessage(ctx, userID, m)
}
