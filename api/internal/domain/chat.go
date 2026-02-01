package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
)

// ChatRepository определяет интерфейс для работы с чатами
type ChatRepository interface {
	// Create создает новый чат
	Create(ctx context.Context, userID uuid.UUID, c *chat.Chat) (*chat.Chat, error)

	// Get получает чат по ID для указанного пользователя
	Get(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) (*chat.Chat, error)

	// List получает список всех чатов пользователя
	List(ctx context.Context, userID uuid.UUID) ([]*chat.Chat, error)

	// Update обновляет существующий чат
	Update(ctx context.Context, userID uuid.UUID, c *chat.Chat) (*chat.Chat, error)

	// Delete удаляет чат
	Delete(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) error

	// GetUserChatsModifiedAfter получает чаты, измененные после указанного времени
	// Используется для условных GET запросов
	GetUserChatsModifiedAfter(ctx context.Context, userID uuid.UUID, since time.Time) ([]*chat.Chat, error)
}
