package storage

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"gorm.io/gorm"
)

var ZeroUUID = uuid.MustParse("00000000-0000-0000-0000-000000000000")

func (s *Storage) CreateMessage(ctx context.Context, userID uuid.UUID, m *chat.Message) (*chat.Message, error) {
	var id = uuid.New()
	if m.ID != ZeroUUID {
		id = m.ID
	}

	messageModel := &Message{
		ID:        id,
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
		ID:        messageModel.ID,
		ChatID:    messageModel.ChatID,
		Role:      chat.Role(messageModel.Role),
		Text:      messageModel.Text,
		Sender:    messageModel.UserID,
		CreatedAt: messageModel.CreatedAt,
	}, nil
}

func (s *Storage) GetMessage(ctx context.Context, userID uuid.UUID, messageID uuid.UUID) (*chat.Message, error) {
	if messageID == ZeroUUID {
		return nil, gorm.ErrRecordNotFound
	}

	var message Message
	if err := s.DB.WithContext(ctx).
		Where("messages.id = ?", messageID).
		First(&message).Error; err != nil {
		return nil, err
	}

	return &chat.Message{
		ID:        message.ID,
		ChatID:    message.ChatID,
		Role:      chat.Role(message.Role),
		Text:      message.Text,
		Sender:    message.UserID,
		CreatedAt: message.CreatedAt,
	}, nil
}

func (s *Storage) GetMessages(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) ([]*chat.Message, error) {
	var messages []Message
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
			ID:        msg.ID,
			ChatID:    msg.ChatID,
			Role:      chat.Role(msg.Role),
			Text:      msg.Text,
			Sender:    msg.UserID,
			CreatedAt: msg.CreatedAt,
		}
	}
	return result, nil
}

// UpdateMessageText updates message text ensuring the message belongs to the user's chat
func (s *Storage) UpdateMessageText(ctx context.Context, userID uuid.UUID, messageID uuid.UUID, newText string) error {
	// Use a subquery to scope update to messages belonging to user's chats
	sub := s.DB.Table("messages").
		Select("messages.id").
		Joins("JOIN chats ON chats.id = messages.chat_id").
		Where("messages.id = ? AND chats.user_id = ?", messageID, userID)

	return s.DB.WithContext(ctx).
		Model(&Message{}).
		Where("id IN (?)", sub).
		Updates(map[string]any{
			"text":       newText,
			"updated_at": time.Now(),
		}).Error
}

func (s *Storage) UpsertMessage(ctx context.Context, userID uuid.UUID, m *chat.Message) error {
	message, err := s.GetMessage(ctx, userID, m.ID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if _, err = s.CreateMessage(ctx, userID, m); err != nil {
				return fmt.Errorf("failed to upsert message: %w", err)
			}
			return nil
		}

		return fmt.Errorf("failed to upsert message: %w", err)
	}

	return s.UpdateMessageText(ctx, userID, m.ID, message.Text+m.Text)
}
