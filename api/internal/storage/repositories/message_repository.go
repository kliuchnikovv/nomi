package repositories

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/domain"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// messageRepository реализует domain.MessageRepository используя storage.Storage
type messageRepository struct {
	storage *storage.Storage
}

// NewMessageRepository создает новый экземпляр MessageRepository
func NewMessageRepository(s *storage.Storage) domain.MessageRepository {
	return &messageRepository{
		storage: s,
	}
}

func (r *messageRepository) Create(ctx context.Context, userID uuid.UUID, m *chat.Message) (*chat.Message, error) {
	return r.storage.CreateMessage(ctx, userID, m)
}

func (r *messageRepository) Get(ctx context.Context, userID uuid.UUID, messageID uuid.UUID) (*chat.Message, error) {
	return r.storage.GetMessage(ctx, userID, messageID)
}

func (r *messageRepository) GetMessages(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, limit ...int) ([]*chat.Message, error) {
	return r.storage.GetMessages(ctx, userID, chatID, limit...)
}

func (r *messageRepository) GetMessagesAfter(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, since time.Time) ([]*chat.Message, error) {
	return r.storage.GetMessagesAfter(ctx, userID, chatID, since)
}

func (r *messageRepository) Upsert(ctx context.Context, userID uuid.UUID, m *chat.Message) error {
	return r.storage.UpsertMessage(ctx, userID, m)
}
