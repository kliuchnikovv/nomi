package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat" // Added for logging
	"gorm.io/gorm"
	// Added for OnConflict clause
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

	// Handle ToolCalls if provided
	if m.ToolCalls != nil {
		toolCallsJSON, err := json.Marshal(m.ToolCalls)
		if err == nil {
			messageModel.ToolCalls = toolCallsJSON
		}
	}

	// Handle Model if provided
	if m.Model != "" {
		messageModel.Model = m.Model
	}

	if err := s.DB.WithContext(ctx).Create(messageModel).Error; err != nil {
		return nil, err
	}

	result := &chat.Message{
		ID:        messageModel.ID,
		ChatID:    messageModel.ChatID,
		Role:      chat.Role(messageModel.Role),
		Text:      messageModel.Text,
		Sender:    messageModel.UserID,
		Model:     messageModel.Model,
		CreatedAt: messageModel.CreatedAt,
	}

	// Unmarshal ToolCalls if present
	if len(messageModel.ToolCalls) > 0 {
		var toolCalls interface{}
		if err := json.Unmarshal(messageModel.ToolCalls, &toolCalls); err == nil {
			result.ToolCalls = toolCalls
		}
	}

	return result, nil
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

	result := &chat.Message{
		ID:        message.ID,
		ChatID:    message.ChatID,
		Role:      chat.Role(message.Role),
		Text:      message.Text,
		Sender:    message.UserID,
		Model:     message.Model,
		CreatedAt: message.CreatedAt,
	}

	// Unmarshal ToolCalls if present
	if len(message.ToolCalls) > 0 {
		var toolCalls interface{}
		if err := json.Unmarshal(message.ToolCalls, &toolCalls); err == nil {
			result.ToolCalls = toolCalls
		}
	}

	return result, nil
}

func (s *Storage) GetMessages(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, limit ...int) ([]*chat.Message, error) {
	query := s.DB.WithContext(ctx).
		Joins("JOIN chats ON messages.chat_id = chats.id").
		Where("messages.chat_id = ? AND chats.user_id = ?", chatID, userID).
		Order("messages.created_at ASC")

	// Apply limit if provided
	if len(limit) > 0 && limit[0] > 0 {
		query = query.Limit(limit[0])
	}

	var messages []Message
	if err := query.Find(&messages).Error; err != nil {
		return nil, err
	}

	result := make([]*chat.Message, len(messages))
	for i, msg := range messages {
		m := &chat.Message{
			ID:        msg.ID,
			ChatID:    msg.ChatID,
			Role:      chat.Role(msg.Role),
			Text:      msg.Text,
			Sender:    msg.UserID,
			Model:     msg.Model,
			CreatedAt: msg.CreatedAt,
		}

		// Unmarshal ToolCalls if present
		if len(msg.ToolCalls) > 0 {
			var toolCalls interface{}
			if err := json.Unmarshal(msg.ToolCalls, &toolCalls); err == nil {
				m.ToolCalls = toolCalls
			}
		}

		result[i] = m
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
