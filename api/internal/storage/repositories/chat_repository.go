package repositories

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/domain"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// chatRepository реализует domain.ChatRepository используя storage.Storage
type chatRepository struct {
	storage *storage.Storage
}

// NewChatRepository создает новый экземпляр ChatRepository
func NewChatRepository(s *storage.Storage) domain.ChatRepository {
	return &chatRepository{
		storage: s,
	}
}

func (r *chatRepository) Create(ctx context.Context, userID uuid.UUID, c *chat.Chat) (*chat.Chat, error) {
	return r.storage.CreateChat(ctx, userID, c)
}

func (r *chatRepository) Get(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) (*chat.Chat, error) {
	return r.storage.GetChat(ctx, userID, chatID)
}

func (r *chatRepository) List(ctx context.Context, userID uuid.UUID) ([]*chat.Chat, error) {
	return r.storage.GetUserChats(ctx, userID)
}

func (r *chatRepository) Update(ctx context.Context, userID uuid.UUID, c *chat.Chat) (*chat.Chat, error) {
	return r.storage.UpdateChat(ctx, userID, c)
}

func (r *chatRepository) Delete(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) error {
	return r.storage.DeleteChat(ctx, userID, chatID)
}

func (r *chatRepository) GetUserChatsModifiedAfter(ctx context.Context, userID uuid.UUID, since time.Time) ([]*chat.Chat, error) {
	return r.storage.GetUserChatsModifiedAfter(ctx, userID, since)
}
