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

	// Handle ContentParts if provided
	if m.ContentParts != nil {
		contentPartsJSON, err := json.Marshal(m.ContentParts)
		if err == nil {
			messageModel.ContentParts = contentPartsJSON
		}
	}

	// Handle Actions if provided
	if m.Actions != nil {
		actionsJSON, err := json.Marshal(m.Actions)
		if err == nil {
			messageModel.Actions = actionsJSON
		}
	}

	// Handle Model if provided
	if m.Model != "" {
		messageModel.Model = m.Model
	}

	if err := s.DB.WithContext(ctx).Create(messageModel).Error; err != nil {
		return nil, err
	}

	// Link attachments if provided
	if len(m.AttachmentIDs) > 0 {
		res := s.DB.WithContext(ctx).Model(&Attachment{}).
			Where("id IN ? AND user_id = ?", m.AttachmentIDs, userID).
			Update("message_id", messageModel.ID)

		if res.Error != nil {
			return nil, res.Error
		}
		fmt.Printf("Storage: Linked %d attachments to message %s (requested %d)\n", res.RowsAffected, messageModel.ID, len(m.AttachmentIDs))
	}

	// Retrieve attachments to return in response
	var attachments []Attachment
	if err := s.DB.WithContext(ctx).Where("message_id = ?", messageModel.ID).Find(&attachments).Error; err != nil {
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

	// Map attachments
	if len(attachments) > 0 {
		result.Attachments = make([]chat.Attachment, len(attachments))
		for i, att := range attachments {
			result.Attachments[i] = chat.Attachment{
				ID:       att.ID,
				FileName: att.FileName,
				FileType: att.FileType,
				Size:     att.Size,
			}
		}
	}

	// Unmarshal ToolCalls if present
	if len(messageModel.ToolCalls) > 0 {
		var toolCalls interface{}
		if err := json.Unmarshal(messageModel.ToolCalls, &toolCalls); err == nil {
			result.ToolCalls = toolCalls
		}
	}

	// Unmarshal ContentParts if present
	if len(messageModel.ContentParts) > 0 {
		var contentParts interface{}
		if err := json.Unmarshal(messageModel.ContentParts, &contentParts); err == nil {
			result.ContentParts = contentParts
		}
	}

	// Unmarshal Actions if present
	if len(messageModel.Actions) > 0 {
		var actions interface{}
		if err := json.Unmarshal(messageModel.Actions, &actions); err == nil {
			result.Actions = actions
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
		Preload("Attachments").
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

	// Map attachments
	if len(message.Attachments) > 0 {
		result.Attachments = make([]chat.Attachment, len(message.Attachments))
		for i, att := range message.Attachments {
			result.Attachments[i] = chat.Attachment{
				ID:       att.ID,
				FileName: att.FileName,
				FileType: att.FileType,
				Size:     att.Size,
			}
		}
	}

	// Unmarshal ToolCalls if present
	if len(message.ToolCalls) > 0 {
		var toolCalls interface{}
		if err := json.Unmarshal(message.ToolCalls, &toolCalls); err == nil {
			result.ToolCalls = toolCalls
		}
	}

	// Unmarshal ContentParts if present
	if len(message.ContentParts) > 0 {
		var contentParts interface{}
		if err := json.Unmarshal(message.ContentParts, &contentParts); err == nil {
			result.ContentParts = contentParts
		}
	}

	// Unmarshal Actions if present
	if len(message.Actions) > 0 {
		var actions interface{}
		if err := json.Unmarshal(message.Actions, &actions); err == nil {
			result.Actions = actions
		}
	}

	return result, nil
}

func (s *Storage) GetMessages(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, limit ...int) ([]*chat.Message, error) {
	query := s.DB.WithContext(ctx).
		Preload("Attachments").
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

		// Map attachments
		if len(msg.Attachments) > 0 {
			m.Attachments = make([]chat.Attachment, len(msg.Attachments))
			for j, att := range msg.Attachments {
				m.Attachments[j] = chat.Attachment{
					ID:       att.ID,
					FileName: att.FileName,
					FileType: att.FileType,
					Size:     att.Size,
				}
			}
		}

		// Unmarshal ToolCalls if present
		if len(msg.ToolCalls) > 0 {
			var toolCalls interface{}
			if err := json.Unmarshal(msg.ToolCalls, &toolCalls); err == nil {
				m.ToolCalls = toolCalls
			}
		}

		// Unmarshal ContentParts if present
		if len(msg.ContentParts) > 0 {
			var contentParts interface{}
			if err := json.Unmarshal(msg.ContentParts, &contentParts); err == nil {
				m.ContentParts = contentParts
			}
		}

		// Unmarshal Actions if present
		if len(msg.Actions) > 0 {
			var actions interface{}
			if err := json.Unmarshal(msg.Actions, &actions); err == nil {
				m.Actions = actions
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
	_, err := s.GetMessage(ctx, userID, m.ID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Message doesn't exist, create it
			if _, err = s.CreateMessage(ctx, userID, m); err != nil {
				return fmt.Errorf("failed to create message in upsert: %w", err)
			}
			return nil
		}
		return fmt.Errorf("failed to get message in upsert: %w", err)
	}

	// Message exists, update all fields
	// NOTE: Text is REPLACED, not appended. Caller is responsible for accumulation.
	updates := map[string]interface{}{
		"text":       m.Text,
		"updated_at": time.Now().UTC(),
	}

	// Update model if provided
	if m.Model != "" {
		updates["model"] = m.Model
	}

	// Update tool_calls if provided
	if m.ToolCalls != nil {
		toolCallsJSON, err := json.Marshal(m.ToolCalls)
		if err == nil {
			updates["tool_calls"] = toolCallsJSON
		}
	}

	// Update content_parts if provided
	if m.ContentParts != nil {
		contentPartsJSON, err := json.Marshal(m.ContentParts)
		if err == nil {
			updates["content_parts"] = contentPartsJSON
		}
	}

	// Update actions if provided
	if m.Actions != nil {
		actionsJSON, err := json.Marshal(m.Actions)
		if err == nil {
			updates["actions"] = actionsJSON
		}
	}

	result := s.DB.WithContext(ctx).
		Model(&Message{}).
		Where("id = ? AND user_id = ?", m.ID, userID).
		Updates(updates)

	if result.Error != nil {
		return fmt.Errorf("failed to update message in upsert: %w", result.Error)
	}

	// Log if no rows were affected - this indicates user_id mismatch
	if result.RowsAffected == 0 {
		fmt.Printf("[WARN] UpsertMessage: UPDATE affected 0 rows for msg_id=%s user_id=%s - possible user_id mismatch\n", m.ID, userID)
	}

	return nil
}
