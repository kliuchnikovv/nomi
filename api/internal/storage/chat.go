package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"gorm.io/gorm"
)

func (s *Storage) CreateChat(ctx context.Context, userID uuid.UUID, c *chat.Chat) (*chat.Chat, error) {
	// Default mode to 'agent' if not specified
	mode := c.Mode
	if mode == "" {
		mode = "agent"
	}

	chatModel := &Chat{
		ID:        c.ID,
		UserID:    userID,
		Model:     c.Model,
		Title:     c.Title,
		Mode:      mode,
		TeamID:    c.TeamID,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := s.DB.WithContext(ctx).Create(chatModel).Error; err != nil {
		return nil, err
	}

	return &chat.Chat{
		ID:        chatModel.ID,
		Model:     chatModel.Model,
		Title:     chatModel.Title,
		Mode:      chatModel.Mode,
		TeamID:    chatModel.TeamID,
		CreatedAt: chatModel.CreatedAt,
		UpdatedAt: chatModel.UpdatedAt,
	}, nil
}

func (s *Storage) GetChat(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) (*chat.Chat, error) {
	var chatModel Chat
	if err := s.DB.WithContext(ctx).
		Where("id = ? AND user_id = ?", chatID, userID).
		First(&chatModel).Error; err != nil {
		return nil, err
	}

	return &chat.Chat{
		ID:         chatModel.ID,
		Model:      chatModel.Model,
		Title:      chatModel.Title,
		Mode:       chatModel.Mode,
		TeamID:     chatModel.TeamID,
		CreatedAt:  chatModel.CreatedAt,
		UpdatedAt:  chatModel.UpdatedAt,
		ArchivedAt: chatModel.ArchivedAt,
	}, nil
}

func (s *Storage) GetUserChats(ctx context.Context, userID uuid.UUID) ([]*chat.Chat, error) {
	var chatModels []Chat
	if err := s.DB.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("updated_at DESC").
		Find(&chatModels).Error; err != nil {
		return nil, err
	}

	chats := make([]*chat.Chat, len(chatModels))
	for i, model := range chatModels {
		chats[i] = &chat.Chat{
			ID:         model.ID,
			Model:      model.Model,
			Title:      model.Title,
			Mode:       model.Mode,
			TeamID:     model.TeamID,
			CreatedAt:  model.CreatedAt,
			UpdatedAt:  model.UpdatedAt,
			ArchivedAt: model.ArchivedAt,
		}
	}
	return chats, nil
}

func (s *Storage) UpdateChat(ctx context.Context, userID uuid.UUID, c *chat.Chat) (*chat.Chat, error) {
	result := s.DB.WithContext(ctx).Model(&Chat{}).
		Where("id = ? AND user_id = ?", c.ID, userID).
		Updates(map[string]any{
			"title":       c.Title,
			"model":       c.Model,
			"updated_at":  time.Now(),
			"archived_at": c.ArchivedAt,
		})

	if result.Error != nil {
		return nil, result.Error
	}

	if result.RowsAffected == 0 {
		return nil, gorm.ErrRecordNotFound
	}

	return s.GetChat(ctx, userID, c.ID)
}

// GetUserChatsModifiedAfter retrieves chats modified after the specified timestamp
// Used for conditional GET requests to reduce unnecessary data transfer
func (s *Storage) GetUserChatsModifiedAfter(ctx context.Context, userID uuid.UUID, since time.Time) ([]*chat.Chat, error) {
	var chatModels []Chat
	if err := s.DB.WithContext(ctx).
		Where("user_id = ? AND updated_at > ?", userID, since).
		Order("updated_at DESC").
		Find(&chatModels).Error; err != nil {
		return nil, err
	}

	chats := make([]*chat.Chat, len(chatModels))
	for i, model := range chatModels {
		chats[i] = &chat.Chat{
			ID:         model.ID,
			Model:      model.Model,
			Title:      model.Title,
			Mode:       model.Mode,
			TeamID:     model.TeamID,
			CreatedAt:  model.CreatedAt,
			UpdatedAt:  model.UpdatedAt,
			ArchivedAt: model.ArchivedAt,
		}
	}
	return chats, nil
}

func (s *Storage) DeleteChat(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) error {
	result := s.DB.WithContext(ctx).Where("id = ? AND user_id = ?", chatID, userID).Delete(&Chat{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
