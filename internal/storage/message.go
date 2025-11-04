package storage

import (
    "context"
    "time"

    "github.com/google/uuid"
    "github.com/kliuchnikovv/genie-api/internal/chat"
)

func (s *Storage) CreateMessage(ctx context.Context, userID uuid.UUID, m *chat.Message) (*chat.Message, error) {
	messageModel := &Message{
		ID:        uuid.New(),
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
