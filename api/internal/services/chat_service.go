package services

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/domain"
)

// ChatService содержит бизнес-логику для работы с чатами
type ChatService struct {
	repo domain.ChatRepository
}

// NewChatService создает новый экземпляр ChatService
func NewChatService(repo domain.ChatRepository) *ChatService {
	return &ChatService{
		repo: repo,
	}
}

// CreateChatRequest представляет запрос на создание чата
type CreateChatRequest struct {
	Model      string     `json:"model"`
	Title      string     `json:"title"`
	Mode       string     `json:"mode"`
	TeamID     *string    `json:"team_id,omitempty"`
	ProjectID  *uuid.UUID `json:"project_id,omitempty"`
	TaskID     *uuid.UUID `json:"task_id,omitempty"`
}

// CreateChat создает новый чат с валидацией и бизнес-логикой
// Принимает chat.Chat для обратной совместимости с handlers
func (s *ChatService) CreateChat(ctx context.Context, userID uuid.UUID, req interface{}) (*chat.Chat, error) {
	var createReq *CreateChatRequest
	
	// Поддержка обоих форматов: CreateChatRequest и chat.Chat
	switch v := req.(type) {
	case *CreateChatRequest:
		createReq = v
	case *chat.Chat:
		createReq = &CreateChatRequest{
			Model:      v.Model,
			Title:      v.Title,
			Mode:       v.Mode,
			TeamID:     v.TeamID,
			ProjectID:  v.ProjectID,
			TaskID:     v.TaskID,
		}
	default:
		return nil, ErrInvalidRequest
	}

	// Определяем mode по умолчанию
	mode := createReq.Mode
	if mode == "" {
		if createReq.TeamID != nil && *createReq.TeamID != "" {
			mode = "team"
		} else {
			mode = "agent"
		}
	}

	// Создаем чат
	c := &chat.Chat{
		ID:        uuid.New(),
		Model:     createReq.Model,
		Title:     createReq.Title,
		Mode:      mode,
		TeamID:    createReq.TeamID,
		ProjectID: createReq.ProjectID,
		TaskID:    createReq.TaskID,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}

	createdChat, err := s.repo.Create(ctx, userID, c)
	if err != nil {
		return nil, err
	}

	// Добавляем иконку
	createdChat.Icon = s.getIconForTeam(createdChat.TeamID)

	return createdChat, nil
}

// GetChat получает чат по ID и добавляет иконку
func (s *ChatService) GetChat(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) (*chat.Chat, error) {
	c, err := s.repo.Get(ctx, userID, chatID)
	if err != nil {
		return nil, err
	}

	c.Icon = s.getIconForTeam(c.TeamID)
	return c, nil
}

// ListChats получает список чатов с поддержкой условного GET
func (s *ChatService) ListChats(ctx context.Context, userID uuid.UUID, ifModifiedSince *time.Time) ([]*chat.Chat, error) {
	var chats []*chat.Chat
	var err error

	if ifModifiedSince != nil {
		chats, err = s.repo.GetUserChatsModifiedAfter(ctx, userID, *ifModifiedSince)
		if err != nil {
			return nil, err
		}
	} else {
		chats, err = s.repo.List(ctx, userID)
		if err != nil {
			return nil, err
		}
	}

	// Добавляем иконки ко всем чатам
	for i := range chats {
		chats[i].Icon = s.getIconForTeam(chats[i].TeamID)
	}

	return chats, nil
}

// UpdateChatRequest представляет запрос на обновление чата
type UpdateChatRequest struct {
	Title      *string     `json:"title,omitempty"`
	Model      *string     `json:"model,omitempty"`
	ArchivedAt *time.Time  `json:"archived_at,omitempty"`
}

// UpdateChat обновляет чат
// Принимает chat.Chat для обратной совместимости с handlers
func (s *ChatService) UpdateChat(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, req interface{}) (*chat.Chat, error) {
	// Получаем текущий чат
	currentChat, err := s.repo.Get(ctx, userID, chatID)
	if err != nil {
		return nil, err
	}

	// Поддержка обоих форматов: UpdateChatRequest и chat.Chat
	switch v := req.(type) {
	case *UpdateChatRequest:
		// Применяем обновления
		if v.Title != nil {
			currentChat.Title = *v.Title
		}
		if v.Model != nil {
			currentChat.Model = *v.Model
		}
		if v.ArchivedAt != nil {
			currentChat.ArchivedAt = v.ArchivedAt
		}
	case *chat.Chat:
		// Применяем обновления из chat.Chat
		if v.Title != "" {
			currentChat.Title = v.Title
		}
		if v.Model != "" {
			currentChat.Model = v.Model
		}
		if v.ArchivedAt != nil {
			currentChat.ArchivedAt = v.ArchivedAt
		}
	default:
		return nil, ErrInvalidRequest
	}

	updatedChat, err := s.repo.Update(ctx, userID, currentChat)
	if err != nil {
		return nil, err
	}

	updatedChat.Icon = s.getIconForTeam(updatedChat.TeamID)
	return updatedChat, nil
}

// DeleteChat удаляет чат
func (s *ChatService) DeleteChat(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) error {
	return s.repo.Delete(ctx, userID, chatID)
}

// GetIconForTeam возвращает иконку для команды
// Перенесено из handlers/chat.go
func (s *ChatService) GetIconForTeam(teamID *string) string {
	return s.getIconForTeam(teamID)
}

// getIconForTeam возвращает иконку для команды
// Перенесено из handlers/chat.go
func (s *ChatService) getIconForTeam(teamID *string) string {
	if teamID == nil {
		return ""
	}
	switch *teamID {
	case "dnd_team":
		return "d20"
	case "genie":
		return "sparkles"
	case "development_team":
		return "code"
	case "travel_planning":
		return "plane"
	case "analyst":
		return "search"
	case "architect":
		return "building"
	case "developer":
		return "terminal"
	case "worker":
		return "cog"
	case "reviewer":
		return "check"
	default:
		return ""
	}
}
