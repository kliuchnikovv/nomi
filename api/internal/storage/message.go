package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat" // Added for logging
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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
		Reasoning: m.Reasoning,
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

	// Handle ContextItems if provided
	if m.ContextItems != nil {
		contextItemsJSON, err := json.Marshal(m.ContextItems)
		if err == nil {
			messageModel.ContextItems = contextItemsJSON
		}
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
		Reasoning: messageModel.Reasoning,
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
		var toolCalls []chat.ToolCall
		if err := json.Unmarshal(messageModel.ToolCalls, &toolCalls); err == nil {
			result.ToolCalls = toolCalls
		}
	}

	// Unmarshal ContentParts if present
	if len(messageModel.ContentParts) > 0 {
		var contentParts []chat.ContentPart
		if err := json.Unmarshal(messageModel.ContentParts, &contentParts); err == nil {
			result.ContentParts = contentParts
		}
	}

	// Unmarshal Actions if present
	if len(messageModel.Actions) > 0 {
		var actions []chat.Action
		if err := json.Unmarshal(messageModel.Actions, &actions); err == nil {
			result.Actions = actions
		}
	}

	// Update updated_at for this chat to reflect new "meaningful" activity.
	// A new message is created here (not a streaming frame), so this is a valid point
	// to push the chat up in activity lists.
	_ = s.TouchChatActivity(ctx, m.ChatID, messageModel.CreatedAt)

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
		Reasoning: message.Reasoning,
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
		var toolCalls []chat.ToolCall
		if err := json.Unmarshal(message.ToolCalls, &toolCalls); err == nil {
			result.ToolCalls = toolCalls
		}
	}

	// Unmarshal ContentParts if present
	if len(message.ContentParts) > 0 {
		var contentParts []chat.ContentPart
		if err := json.Unmarshal(message.ContentParts, &contentParts); err == nil {
			result.ContentParts = contentParts
		}
	}

	// Backfill reasoning into ContentParts if missing but present in Reasoning column
	if message.Reasoning != "" {
		hasReasoning := false
		for _, p := range result.ContentParts {
			if p.Type == "reasoning" {
				hasReasoning = true
				break
			}
		}
		if !hasReasoning {
			// Append reasoning part
			result.ContentParts = append(result.ContentParts, chat.ContentPart{
				Type:      "reasoning",
				Reasoning: message.Reasoning,
			})
		}
	}

	// Unmarshal Actions if present
	if len(message.Actions) > 0 {
		var actions []chat.Action
		if err := json.Unmarshal(message.Actions, &actions); err == nil {
			result.Actions = actions
		}
	}

	return result, nil
}

func (s *Storage) GetMessages(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, limit ...int) ([]*chat.Message, error) {
	// Order DESC so LIMIT fetches the newest messages, then reverse for chronological order.
	query := s.DB.WithContext(ctx).
		Preload("Attachments").
		Joins("JOIN chats ON messages.chat_id = chats.id").
		Where("messages.chat_id = ? AND chats.user_id = ? AND messages.archived = ?", chatID, userID, false).
		Order("messages.created_at DESC")

	if len(limit) > 0 && limit[0] > 0 {
		query = query.Limit(limit[0])
	}

	var messages []Message
	if err := query.Find(&messages).Error; err != nil {
		return nil, err
	}

	// Reverse to restore oldest-first order expected by callers.
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	result := make([]*chat.Message, len(messages))
	for i, msg := range messages {
		m := &chat.Message{
			ID:        msg.ID,
			ChatID:    msg.ChatID,
			Role:      chat.Role(msg.Role),
			Text:      msg.Text,
			Reasoning: msg.Reasoning,
			Sender:    msg.UserID,
			Model:     msg.Model,
			CreatedAt: msg.CreatedAt,
			StoppedAt: msg.StoppedAt,
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
			var toolCalls []chat.ToolCall
			if err := json.Unmarshal(msg.ToolCalls, &toolCalls); err == nil {
				m.ToolCalls = toolCalls
			}
		}

		// Unmarshal ContentParts if present
		if len(msg.ContentParts) > 0 {
			var contentParts []chat.ContentPart
			if err := json.Unmarshal(msg.ContentParts, &contentParts); err == nil {
				m.ContentParts = contentParts
			}
		}

		// Backfill reasoning into ContentParts if missing but present in Reasoning column
		// This handles cases where ContentParts were not correctly saved or are from legacy messages
		if m.Reasoning != "" {
			hasReasoning := false
			for _, p := range m.ContentParts {
				if p.Type == "reasoning" {
					hasReasoning = true
					break
				}
			}
			if !hasReasoning {
				// Append reasoning part
				m.ContentParts = append(m.ContentParts, chat.ContentPart{
					Type:      "reasoning",
					Reasoning: m.Reasoning,
				})
			}
		}

		// Unmarshal Actions if present
		if len(msg.Actions) > 0 {
			var actions []chat.Action
			if err := json.Unmarshal(msg.Actions, &actions); err == nil {
				m.Actions = actions
			}
		}

		// Unmarshal ContextItems if present
		if len(msg.ContextItems) > 0 {
			m.ContextItems = msg.ContextItems
		}

		result[i] = m
	}
	return result, nil
}

// GetMessagesAfter retrieves messages created after the specified timestamp
// Used for conditional GET requests to reduce unnecessary data transfer
func (s *Storage) GetMessagesAfter(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, since time.Time) ([]*chat.Message, error) {
	query := s.DB.WithContext(ctx).
		Preload("Attachments").
		Joins("JOIN chats ON messages.chat_id = chats.id").
		Where("chats.user_id = ? AND messages.chat_id = ? AND messages.created_at > ?", userID, chatID, since).
		Order("messages.created_at ASC")

	var messages []Message
	if err := query.Find(&messages).Error; err != nil {
		return nil, err
	}

	// Convert to domain model (same as GetMessages)
	result := make([]*chat.Message, len(messages))
	for i, msg := range messages {
		m := &chat.Message{
			ID:        msg.ID,
			ChatID:    msg.ChatID,
			Role:      chat.Role(msg.Role),
			Text:      msg.Text,
			Reasoning: msg.Reasoning,
			Sender:    msg.UserID,
			Model:     msg.Model,
			CreatedAt: msg.CreatedAt,
			StoppedAt: msg.StoppedAt,
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
			var toolCalls []chat.ToolCall
			if err := json.Unmarshal(msg.ToolCalls, &toolCalls); err == nil {
				m.ToolCalls = toolCalls
			}
		}

		// Unmarshal ContentParts if present
		if len(msg.ContentParts) > 0 {
			var contentParts []chat.ContentPart
			if err := json.Unmarshal(msg.ContentParts, &contentParts); err == nil {
				m.ContentParts = contentParts
			}
		}

		// Unmarshal Actions if present
		if len(msg.Actions) > 0 {
			var actions []chat.Action
			if err := json.Unmarshal(msg.Actions, &actions); err == nil {
				m.Actions = actions
			}
		}

		// Unmarshal ContextItems if present
		if len(msg.ContextItems) > 0 {
			m.ContextItems = msg.ContextItems
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
	if m.ID == ZeroUUID {
		return fmt.Errorf("upsert requires a valid message ID")
	}

	// Verify the chat belongs to the user before writing
	var count int64
	s.DB.WithContext(ctx).Model(&Chat{}).
		Where("id = ? AND user_id = ?", m.ChatID, userID).
		Count(&count)
	if count == 0 {
		return fmt.Errorf("chat %s does not belong to user %s", m.ChatID, userID)
	}

	now := time.Now()
	// Preserve original CreatedAt if provided; only set on first insert.
	createdAt := now
	if !m.CreatedAt.IsZero() {
		createdAt = m.CreatedAt
	}

	messageModel := &Message{
		ID:        m.ID,
		ChatID:    m.ChatID,
		UserID:    userID,
		Role:      string(m.Role),
		Text:      m.Text,
		Reasoning: m.Reasoning,
		CreatedAt: createdAt,
		UpdatedAt: now,
	}

	// Update model if provided
	if m.Model != "" {
		messageModel.Model = m.Model
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

	// Handle Meta if provided
	if m.Meta != nil {
		metaJSON, err := json.Marshal(m.Meta)
		if err == nil {
			messageModel.Meta = metaJSON
		}
	}

	// Use OnConflict to handle race conditions between Create and Update.
	// We only update fields that should be changed during an upsert.
	// We don't update user_id, chat_id, or created_at to prevent accidental reassignment.
	err := s.DB.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"text", "reasoning", "tool_calls", "content_parts", "actions", "updated_at", "model",
		}),
	}).Create(messageModel).Error

	if err != nil {
		return fmt.Errorf("failed to upsert message: %w", err)
	}

	// Link attachments if provided (idempotent)
	if len(m.AttachmentIDs) > 0 {
		res := s.DB.WithContext(ctx).Model(&Attachment{}).
			Where("id IN ? AND user_id = ?", m.AttachmentIDs, userID).
			Update("message_id", messageModel.ID)

		if res.Error != nil {
			return fmt.Errorf("failed to link attachments in upsert: %w", res.Error)
		}
	}

	return nil
}

// MarkChatStopped stamps StoppedAt on the most recent user message of a chat.
// Called when the user explicitly stops generation, so the client can tell a
// stopped turn apart from an interrupted one and skip auto re-submission.
func (s *Storage) MarkChatStopped(ctx context.Context, chatID uuid.UUID, ts time.Time) error {
	// Subquery: id of the latest user message in this chat.
	var msgID uuid.UUID
	err := s.DB.WithContext(ctx).
		Model(&Message{}).
		Where("chat_id = ? AND role = ?", chatID, "user").
		Order("created_at DESC").
		Limit(1).
		Pluck("id", &msgID).Error
	if err != nil {
		return fmt.Errorf("failed to find latest user message to mark stopped: %w", err)
	}
	if msgID == ZeroUUID {
		return nil // nothing to mark
	}
	if err := s.DB.WithContext(ctx).
		Model(&Message{}).
		Where("id = ?", msgID).
		Update("stopped_at", ts).Error; err != nil {
		return fmt.Errorf("failed to mark message stopped: %w", err)
	}
	return nil
}

// ArchiveMessages marks the given message IDs as archived.
func (s *Storage) ArchiveMessages(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, messageIDs []uuid.UUID) error {
	return s.DB.WithContext(ctx).
		Model(&Message{}).
		Where("id IN ? AND chat_id = ? AND user_id = ?", messageIDs, chatID, userID).
		Updates(map[string]any{
			"archived":   true,
			"updated_at": time.Now(),
		}).Error
}
