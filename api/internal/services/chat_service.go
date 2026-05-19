package services

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage/repositories"
)

const defaultPersistentChatModel = "glm-4-flash"

// ChatService contains business logic for chat operations
type ChatService struct {
	repo repositories.ChatRepository
}

// NewChatService creates a new ChatService instance
func NewChatService(repo repositories.ChatRepository) *ChatService {
	return &ChatService{
		repo: repo,
	}
}

// CreateChatRequest represents a request to create a chat
type CreateChatRequest struct {
	Model  string  `json:"model"`
	Title  string  `json:"title"`
	Mode   string  `json:"mode"`
	TeamID *string `json:"team_id,omitempty"`
	Type   string  `json:"type,omitempty"`
}

// CreateChat creates a new chat with validation and business logic
// Accepts chat.Chat for backward compatibility with handlers
func (s *ChatService) CreateChat(ctx context.Context, userID uuid.UUID, req interface{}) (*chat.Chat, error) {
	var createReq *CreateChatRequest

	// Support both formats: CreateChatRequest and chat.Chat
	switch v := req.(type) {
	case *CreateChatRequest:
		createReq = v
	case *chat.Chat:
		createReq = &CreateChatRequest{
			Model:  v.Model,
			Title:  v.Title,
			Mode:   v.Mode,
			TeamID: v.TeamID,
			Type:   v.Type,
		}
	default:
		return nil, ErrInvalidRequest
	}

	// Determine default mode
	mode := createReq.Mode
	if mode == "" {
		if createReq.TeamID != nil && *createReq.TeamID != "" {
			mode = "team"
		} else {
			mode = "agent"
		}
	}

	// Determine chat type
	chatType := createReq.Type
	if chatType == "" {
		chatType = "regular"
	}

	// Create chat
	c := &chat.Chat{
		ID:        uuid.New(),
		Model:     createReq.Model,
		Title:     createReq.Title,
		Mode:      mode,
		Type:      chatType,
		TeamID:    createReq.TeamID,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}

	createdChat, err := s.repo.Create(ctx, userID, c)
	if err != nil {
		return nil, err
	}

	// Add icon: use stored icon or fall back to team-based icon
	if createdChat.Icon == "" {
		createdChat.Icon = s.getIconForTeam(createdChat.TeamID)
	}

	return createdChat, nil
}

// GetChat gets a chat by ID and adds an icon
func (s *ChatService) GetChat(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) (*chat.Chat, error) {
	c, err := s.repo.Get(ctx, userID, chatID)
	if err != nil {
		return nil, err
	}

	if c.Icon == "" {
		c.Icon = s.getIconForTeam(c.TeamID)
	}
	return c, nil
}

// ListChats gets a list of chats with conditional GET support
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

	// Add icons to all chats (use stored icon, fall back to team-based)
	for i := range chats {
		if chats[i].Icon == "" {
			chats[i].Icon = s.getIconForTeam(chats[i].TeamID)
		}
	}

	return chats, nil
}

// UpdateChatRequest represents a request to update a chat
type UpdateChatRequest struct {
	Title      *string    `json:"title,omitempty"`
	Model      *string    `json:"model,omitempty"`
	Icon       *string    `json:"icon,omitempty"`
	ArchivedAt *time.Time `json:"archived_at,omitempty"`
	ProjectID  *string    `json:"project_id,omitempty"` // UUID string or empty string to unassign
}

// UpdateChat updates a chat
// Accepts chat.Chat for backward compatibility with handlers
func (s *ChatService) UpdateChat(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, req interface{}) (*chat.Chat, error) {
	// Get current chat
	currentChat, err := s.repo.Get(ctx, userID, chatID)
	if err != nil {
		return nil, err
	}

	// Support both formats: UpdateChatRequest and chat.Chat
	switch v := req.(type) {
	case *UpdateChatRequest:
		// Apply updates
		if v.Title != nil {
			currentChat.Title = *v.Title
		}
		if v.Model != nil {
			currentChat.Model = *v.Model
		}
		if v.Icon != nil {
			currentChat.Icon = *v.Icon
		}
		if v.ArchivedAt != nil {
			currentChat.ArchivedAt = v.ArchivedAt
		}
		if v.ProjectID != nil {
			if *v.ProjectID == "" {
				currentChat.ProjectID = nil
			} else {
				parsed, err := uuid.Parse(*v.ProjectID)
				if err != nil {
					return nil, ErrInvalidRequest
				}
				currentChat.ProjectID = &parsed
			}
		}
	case *chat.Chat:
		// Apply updates from chat.Chat
		if v.Title != "" {
			currentChat.Title = v.Title
		}
		if v.Model != "" {
			currentChat.Model = v.Model
		}
		if v.Icon != "" {
			currentChat.Icon = v.Icon
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

	if updatedChat.Icon == "" {
		updatedChat.Icon = s.getIconForTeam(updatedChat.TeamID)
	}
	return updatedChat, nil
}

// DeleteChat deletes a chat
func (s *ChatService) DeleteChat(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) error {
	return s.repo.Delete(ctx, userID, chatID)
}

// GetOrCreatePersistentChat returns the user's persistent chat, creating it if needed.
func (s *ChatService) GetOrCreatePersistentChat(ctx context.Context, userID uuid.UUID, defaultModel string) (*chat.Chat, error) {
	if defaultModel == "" {
		defaultModel = defaultPersistentChatModel
	}
	c, err := s.repo.GetOrCreatePersistent(ctx, userID, defaultModel)
	if err != nil {
		return nil, err
	}
	if c.Icon == "" {
		c.Icon = s.getIconForTeam(c.TeamID)
	}
	return c, nil
}

// GetLatestPersistentChat returns the most-recent persistent chat for the user.
func (s *ChatService) GetLatestPersistentChat(ctx context.Context, userID uuid.UUID) (*chat.Chat, error) {
	return s.repo.GetLatestPersistent(ctx, userID)
}

// ListPersistentChats returns all persistent chats for the user, newest first.
func (s *ChatService) ListPersistentChats(ctx context.Context, userID uuid.UUID) ([]*chat.Chat, error) {
	return s.repo.ListPersistent(ctx, userID)
}

// ArchiveMessages marks given messages as archived.
func (s *ChatService) ArchiveMessages(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, messageIDs []uuid.UUID) error {
	return s.repo.ArchiveMessages(ctx, userID, chatID, messageIDs)
}

// GetIconForTeam returns the icon for a team
// Moved from handlers/chat.go
func (s *ChatService) GetIconForTeam(teamID *string) string {
	return s.getIconForTeam(teamID)
}

// getIconForTeam returns the icon for a team
// Moved from handlers/chat.go
func (s *ChatService) getIconForTeam(teamID *string) string {
	if teamID == nil {
		return ""
	}
	switch *teamID {
	case "dnd_team":
		return "d20"
	case "nomi":
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
