package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
)

func (s *Storage) CreateMessage(ctx context.Context, userID uuid.UUID, m *chat.Message) (*chat.Message, error) {
	messageModel := &MessageModel{
		ChatID:    m.ChatID,
		UserID:    userID,
		Role:      string(m.Role),
		Text:      m.Text,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := s.DB.WithContext(ctx).Create(messageModel).Error; err != nil {
		return nil, err
	}

	return &chat.Message{
		ChatID: messageModel.ChatID,
		Role:   chat.Role(messageModel.Role),
		Text:   messageModel.Text,
	}, nil
}

func (s *Storage) GetMessages(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) ([]*chat.Message, error) {
	var messages []MessageModel
	if err := s.DB.WithContext(ctx).
		Joins("JOIN chats ON messages.chat_id = chats.id").
		Where("messages.chat_id = ? AND chats.user_id = ?", chatID, userID).
		Order("messages.created_at ASC").
		Find(&messages).Error; err != nil {
		return nil, err
	}

	result := make([]*chat.Message, len(messages))
	for i, msg := range messages {
		result[i] = &chat.Message{
			ChatID: msg.ChatID,
			Role:   chat.Role(msg.Role),
			Text:   msg.Text,
		}
	}
	return result, nil
}
