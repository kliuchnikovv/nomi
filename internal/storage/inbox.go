package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// InboxMessage represents an inbox message with pagination metadata
type InboxMessage struct {
	ID         uuid.UUID `json:"id"`
	Sender     string    `json:"sender"`
	Subject    string    `json:"subject"`
	Snippet    string    `json:"snippet"`
	Body       string    `json:"body"`
	Response   string    `json:"response,omitempty"`
	Status     string    `json:"status"`
	ReceivedAt time.Time `json:"received_at"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
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
func (s *Storage) GetInboxMessages(ctx context.Context, userID uuid.UUID, page, limit int) (*InboxPaginatedResponse, error) {
	// Default pagination values
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20 // default limit
	}

	var totalCount int64
	if err := s.DB.WithContext(ctx).
		Model(&Inbox{}).
		Where("user_id = ?", userID).
		Count(&totalCount).Error; err != nil {
		return nil, err
	}

	offset := (page - 1) * limit
	var inboxModels []Inbox
	if err := s.DB.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("received_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&inboxModels).Error; err != nil {
		return nil, err
	}

	messages := make([]*InboxMessage, len(inboxModels))
	for i, model := range inboxModels {
		messages[i] = &InboxMessage{
			ID:         model.ID,
			Sender:     model.Sender,
			Subject:    model.Subject,
			Snippet:    model.Snippet,
			Body:       model.Body,
			Response:   model.Response,
			Status:     model.Status,
			ReceivedAt: model.ReceivedAt,
			CreatedAt:  model.CreatedAt,
			UpdatedAt:  model.UpdatedAt,
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

	return &InboxMessage{
		ID:         inboxModel.ID,
		Sender:     inboxModel.Sender,
		Subject:    inboxModel.Subject,
		Snippet:    inboxModel.Snippet,
		Body:       inboxModel.Body,
		Response:   inboxModel.Response,
		Status:     inboxModel.Status,
		ReceivedAt: inboxModel.ReceivedAt,
		CreatedAt:  inboxModel.CreatedAt,
		UpdatedAt:  inboxModel.UpdatedAt,
	}, nil
}

// MarkAsRead updates the inbox message status to "read"
func (s *Storage) MarkAsRead(ctx context.Context, userID uuid.UUID, messageID uuid.UUID) error {
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
