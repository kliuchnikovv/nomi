package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
)

// MessageRepository определяет интерфейс для работы с сообщениями
type MessageRepository interface {
	// Create создает новое сообщение
	Create(ctx context.Context, userID uuid.UUID, m *chat.Message) (*chat.Message, error)

	// Get получает сообщение по ID
	Get(ctx context.Context, userID uuid.UUID, messageID uuid.UUID) (*chat.Message, error)

	// GetMessages получает список сообщений для чата
	// limit опциональный параметр для ограничения количества результатов
	GetMessages(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, limit ...int) ([]*chat.Message, error)

	// GetMessagesAfter получает сообщения, созданные после указанного времени
	// Используется для условных GET запросов
	GetMessagesAfter(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, since time.Time) ([]*chat.Message, error)

	// Upsert создает или обновляет сообщение
	// Используется для потоковой записи сообщений ассистента
	Upsert(ctx context.Context, userID uuid.UUID, m *chat.Message) error
}
