package storage

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// InboxAction represents a suggested action for an integration message
// These are used for email-style integrations but can be reused by others.
type InboxAction struct {
	Label   string  `json:"label"`
	Why     string  `json:"why"`
	Command string  `json:"command"`
	Agent   string  `json:"agent"`
	URL     *string `json:"url"`
	Prompt  *string `json:"prompt"`
}

// InboxMessage represents a chat-style message coming from an integration
// with structured LLM analysis fields.
type InboxMessage struct {
	ID            uuid.UUID              `json:"id"`
	IntegrationID uuid.UUID              `json:"integration_id"`
	UserID        uuid.UUID              `json:"-"` // Don't expose in API
	Source        string                 `json:"source"`
	Role          string                 `json:"role"`
	Header        string                 `json:"header"`
	Content       string                 `json:"content"`
	Summary       string                 `json:"summary,omitempty"`
	Importance    string                 `json:"importance,omitempty"`
	Actions       []InboxAction          `json:"actions,omitempty"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
	Status        string                 `json:"status"`
	ReceivedAt    time.Time              `json:"received_at"`
	CreatedAt     time.Time              `json:"created_at"`
	UpdatedAt     time.Time              `json:"updated_at"`
}

// InboxPaginatedResponse represents paginated inbox messages
type InboxPaginatedResponse struct {
	Messages   []*InboxMessage `json:"messages"`
	Page       int             `json:"page"`
	Limit      int             `json:"limit"`
	TotalCount int64           `json:"total_count"`
	TotalPages int             `json:"total_pages"`
}

// GetInboxMessages retrieves paginated inbox messages for a user
func (s *Storage) GetInboxMessages(ctx context.Context, userID uuid.UUID, integrationID *uuid.UUID, page, limit int) (*InboxPaginatedResponse, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}

	query := s.DB.WithContext(ctx).Model(&Inbox{}).Where("user_id = ?", userID)
	if integrationID != nil {
		query = query.Where("integration_id = ?", *integrationID)
	}

	var totalCount int64
	if err := query.Count(&totalCount).Error; err != nil {
		return nil, err
	}

	offset := (page - 1) * limit
	var inboxModels []Inbox
	if err := query.
		Order("received_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&inboxModels).Error; err != nil {
		return nil, err
	}

	messages := make([]*InboxMessage, len(inboxModels))
	for i, model := range inboxModels {
		var actions []InboxAction
		if len(model.Actions) > 0 {
			_ = json.Unmarshal(model.Actions, &actions)
		}

		var metadata map[string]interface{}
		if len(model.Metadata) > 0 {
			_ = json.Unmarshal(model.Metadata, &metadata)
		}

		messages[i] = &InboxMessage{
			ID:            model.ID,
			IntegrationID: model.IntegrationID,
			Source:        model.Source,
			Role:          model.Role,
			Header:        model.Header,
			Content:       model.Content,
			Summary:       model.Summary,
			Importance:    model.Importance,
			Actions:       actions,
			Metadata:      metadata,
			Status:        model.Status,
			ReceivedAt:    model.ReceivedAt,
			CreatedAt:     model.CreatedAt,
			UpdatedAt:     model.UpdatedAt,
		}
	}

	totalPages := int(totalCount) / limit
	if int(totalCount)%limit != 0 {
		totalPages++
	}

	return &InboxPaginatedResponse{
		Messages:   messages,
		Page:       page,
		Limit:      limit,
		TotalCount: totalCount,
		TotalPages: totalPages,
	}, nil
}

// GetInboxMessage retrieves a single inbox message by ID with user ownership verification
func (s *Storage) GetInboxMessage(ctx context.Context, userID uuid.UUID, messageID uuid.UUID) (*InboxMessage, error) {
	var inboxModel Inbox
	if err := s.DB.WithContext(ctx).
		Where("id = ? AND user_id = ?", messageID, userID).
		First(&inboxModel).Error; err != nil {
		return nil, err
	}

	var actions []InboxAction
	if len(inboxModel.Actions) > 0 {
		_ = json.Unmarshal(inboxModel.Actions, &actions)
	}

	var metadata map[string]interface{}
	if len(inboxModel.Metadata) > 0 {
		_ = json.Unmarshal(inboxModel.Metadata, &metadata)
	}

	return &InboxMessage{
		ID:            inboxModel.ID,
		IntegrationID: inboxModel.IntegrationID,
		Source:        inboxModel.Source,
		Role:          inboxModel.Role,
		Header:        inboxModel.Header,
		Content:       inboxModel.Content,
		Summary:       inboxModel.Summary,
		Importance:    inboxModel.Importance,
		Actions:       actions,
		Metadata:      metadata,
		Status:        inboxModel.Status,
		ReceivedAt:    inboxModel.ReceivedAt,
		CreatedAt:     inboxModel.CreatedAt,
		UpdatedAt:     inboxModel.UpdatedAt,
	}, nil
}

// MarkAsRead updates the inbox message status to "read"
func (s *Storage) MarkAsRead(ctx context.Context, userID, messageID uuid.UUID) error {
	result := s.DB.WithContext(ctx).
		Model(&Inbox{}).
		Where("id = ? AND user_id = ?", messageID, userID).
		Updates(map[string]any{
			"status":     "read",
			"updated_at": time.Now(),
		})

	if result.Error != nil {
		return result.Error
	}

	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}

	return nil
}

// UpsertInboxMessage creates or updates an inbox message
func (s *Storage) UpsertInboxMessage(ctx context.Context, userID uuid.UUID, m *InboxMessage) error {
	var inboxModel Inbox
	err := s.DB.WithContext(ctx).
		Where("id = ? AND user_id = ?", m.ID, userID).
		First(&inboxModel).Error

	if err != nil {
		if err == gorm.ErrRecordNotFound {
			// Create new
			inboxModel = Inbox{
				ID:            m.ID,
				UserID:        userID,
				IntegrationID: m.IntegrationID,
				Source:        "chat", // Default for WS chat
				Role:          m.Role,
				Content:       m.Content,
				Header:        m.Header,
				Status:        "read", // Chat messages are read by default
				ReceivedAt:    time.Now(),
				CreatedAt:     time.Now(),
				UpdatedAt:     time.Now(),
			}
			if m.Source != "" {
				inboxModel.Source = m.Source
			}
			if m.Status != "" {
				inboxModel.Status = m.Status
			}

			return s.DB.WithContext(ctx).Create(&inboxModel).Error
		}
		return err
	}

	// Update existing
	updates := map[string]interface{}{
		"content":    inboxModel.Content + m.Content, // Append content for streaming
		"updated_at": time.Now(),
	}

	return s.DB.WithContext(ctx).
		Model(&Inbox{}).
		Where("id = ?", m.ID).
		Updates(updates).Error
}
