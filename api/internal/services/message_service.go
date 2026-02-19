package services

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage/repositories"
)

// MessageService contains business logic for working with messages
type MessageService struct {
	repo repositories.MessageRepository
}

// NewMessageService creates a new instance of MessageService
func NewMessageService(repo repositories.MessageRepository) *MessageService {
	return &MessageService{
		repo: repo,
	}
}

// CreateMessageRequest represents a request to create a message
type CreateMessageRequest struct {
	Text          string      `json:"text"`
	Role          chat.Role   `json:"role"`
	Model         string      `json:"model,omitempty"`
	AttachmentIDs []uuid.UUID `json:"attachment_ids,omitempty"`
	WebSearch     bool        `json:"web_search,omitempty"`
	ContextItems  interface{} `json:"context_items,omitempty"`
}

// CreateMessage creates a new message
// Accepts chat.Message for backward compatibility with handlers
func (s *MessageService) CreateMessage(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, req interface{}) (*chat.Message, error) {
	var createReq *CreateMessageRequest

	// Support both formats: CreateMessageRequest and chat.Message
	switch v := req.(type) {
	case *CreateMessageRequest:
		createReq = v
	case *chat.Message:
		createReq = &CreateMessageRequest{
			Text:          v.Text,
			Role:          v.Role,
			Model:         v.Model,
			AttachmentIDs: v.AttachmentIDs,
			WebSearch:     v.WebSearch,
			ContextItems:  v.ContextItems,
		}
	default:
		return nil, ErrInvalidRequest
	}
	message := &chat.Message{
		ID:            uuid.New(),
		ChatID:        chatID,
		Sender:        userID,
		Role:          createReq.Role,
		Text:          createReq.Text,
		Model:         createReq.Model,
		AttachmentIDs: createReq.AttachmentIDs,
		WebSearch:     createReq.WebSearch,
		ContextItems:  createReq.ContextItems,
		CreatedAt:     time.Now().UTC(),
	}

	return s.repo.Create(ctx, userID, message)
}

// GetMessagesRequest represents a request to get messages
type GetMessagesRequest struct {
	IfModifiedSince *time.Time `json:"-"`
	Limit           *int       `json:"-"`
}

// GetMessages retrieves a list of messages with conditional GET support
func (s *MessageService) GetMessages(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, req *GetMessagesRequest) ([]*chat.Message, error) {
	if req.IfModifiedSince != nil {
		return s.repo.GetMessagesAfter(ctx, userID, chatID, *req.IfModifiedSince)
	}

	if req.Limit != nil {
		return s.repo.GetMessages(ctx, userID, chatID, *req.Limit)
	}

	return s.repo.GetMessages(ctx, userID, chatID)
}

// UpsertMessage updates or creates a message (used for streaming)
func (s *MessageService) UpsertMessage(ctx context.Context, userID uuid.UUID, m *chat.Message) error {
	return s.repo.Upsert(ctx, userID, m)
}
