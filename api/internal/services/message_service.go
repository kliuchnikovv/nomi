package services

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/domain"
)

// MessageService содержит бизнес-логику для работы с сообщениями
type MessageService struct {
	repo domain.MessageRepository
}

// NewMessageService создает новый экземпляр MessageService
func NewMessageService(repo domain.MessageRepository) *MessageService {
	return &MessageService{
		repo: repo,
	}
}

// CreateMessageRequest представляет запрос на создание сообщения
type CreateMessageRequest struct {
	Text          string      `json:"text"`
	Role          chat.Role   `json:"role"`
	Model         string      `json:"model,omitempty"`
	AttachmentIDs []uuid.UUID `json:"attachment_ids,omitempty"`
	WebSearch     bool        `json:"web_search,omitempty"`
}

// CreateMessage создает новое сообщение
// Принимает chat.Message для обратной совместимости с handlers
func (s *MessageService) CreateMessage(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, req interface{}) (*chat.Message, error) {
	var createReq *CreateMessageRequest
	
	// Поддержка обоих форматов: CreateMessageRequest и chat.Message
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
		CreatedAt:     time.Now().UTC(),
	}

	return s.repo.Create(ctx, userID, message)
}

// GetMessagesRequest представляет запрос на получение сообщений
type GetMessagesRequest struct {
	IfModifiedSince *time.Time `json:"-"`
	Limit           *int       `json:"-"`
}

// GetMessages получает список сообщений с поддержкой условного GET
func (s *MessageService) GetMessages(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, req *GetMessagesRequest) ([]*chat.Message, error) {
	if req.IfModifiedSince != nil {
		return s.repo.GetMessagesAfter(ctx, userID, chatID, *req.IfModifiedSince)
	}

	if req.Limit != nil {
		return s.repo.GetMessages(ctx, userID, chatID, *req.Limit)
	}

	return s.repo.GetMessages(ctx, userID, chatID)
}

// UpsertMessage обновляет или создает сообщение (используется для потоковой записи)
func (s *MessageService) UpsertMessage(ctx context.Context, userID uuid.UUID, m *chat.Message) error {
	return s.repo.Upsert(ctx, userID, m)
}
