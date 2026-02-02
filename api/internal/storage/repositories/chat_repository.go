package repositories

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// ChatRepository defines interface for chat operations
type ChatRepository interface {
	Create(ctx context.Context, userID uuid.UUID, c *chat.Chat) (*chat.Chat, error)
	Get(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) (*chat.Chat, error)
	List(ctx context.Context, userID uuid.UUID) ([]*chat.Chat, error)
	Update(ctx context.Context, userID uuid.UUID, c *chat.Chat) (*chat.Chat, error)
	Delete(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) error
	GetUserChatsModifiedAfter(ctx context.Context, userID uuid.UUID, since time.Time) ([]*chat.Chat, error)
}

// NewChatRepository creates a new chat repository
func NewChatRepository(store *storage.Storage) ChatRepository {
	return &chatRepository{store: store}
}

// chatRepository implements ChatRepository interface
type chatRepository struct {
	store *storage.Storage
}

// Create creates a new chat
func (r *chatRepository) Create(ctx context.Context, userID uuid.UUID, c *chat.Chat) (*chat.Chat, error) {
	return r.store.CreateChat(ctx, userID, c)
}

// Get gets a chat by ID
func (r *chatRepository) Get(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) (*chat.Chat, error) {
	return r.store.GetChat(ctx, userID, chatID)
}

// List gets all chats for a user
func (r *chatRepository) List(ctx context.Context, userID uuid.UUID) ([]*chat.Chat, error) {
	return r.store.GetUserChats(ctx, userID)
}

// Update updates a chat
func (r *chatRepository) Update(ctx context.Context, userID uuid.UUID, c *chat.Chat) (*chat.Chat, error) {
	return r.store.UpdateChat(ctx, userID, c)
}

// Delete deletes a chat
func (r *chatRepository) Delete(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) error {
	return r.store.DeleteChat(ctx, userID, chatID)
}

// GetUserChatsModifiedAfter gets chats modified after a specific time
func (r *chatRepository) GetUserChatsModifiedAfter(ctx context.Context, userID uuid.UUID, since time.Time) ([]*chat.Chat, error) {
	return r.store.GetUserChatsModifiedAfter(ctx, userID, since)
}
