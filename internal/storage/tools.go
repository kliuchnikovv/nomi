package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func (s *Storage) AddTools(ctx context.Context, userID uuid.UUID, tools ...Tool) error {
	for i := range tools {
		if _, err := s.CreateTool(ctx, userID, &tools[i]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Storage) CreateTool(ctx context.Context, userID uuid.UUID, tool *Tool) (*Tool, error) {
	now := time.Now().UTC()
	stored := &Tool{
		ID:        tool.ID,
		UserID:    userID,
		Name:      tool.Name,
		Provider:  tool.Provider,
		Params:    tool.Params,
		Enabled:   tool.Enabled,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if stored.ID == uuid.Nil {
		stored.ID = uuid.New()
	}

	if err := s.DB.WithContext(ctx).Create(stored).Error; err != nil {
		return nil, err
	}

	return stored, nil
}

func (s *Storage) GetTools(ctx context.Context, userID uuid.UUID) ([]Tool, error) {
	var result []Tool

	if err := s.DB.WithContext(ctx).
		Where("user_id = ?", userID).
		Find(&result).Error; err != nil {
		return nil, err
	}

	return result, nil
}

func (s *Storage) GetTool(ctx context.Context, userID, toolID uuid.UUID) (*Tool, error) {
	var tool Tool
	if err := s.DB.WithContext(ctx).
		Where("id = ? AND user_id = ?", toolID, userID).
		First(&tool).Error; err != nil {
		return nil, err
	}

	return &tool, nil
}

func (s *Storage) UpdateTool(ctx context.Context, userID uuid.UUID, tool *Tool) (*Tool, error) {
	now := time.Now().UTC()
	result := s.DB.WithContext(ctx).Model(&Tool{}).
		Where("id = ? AND user_id = ?", tool.ID, userID).
		Updates(map[string]any{
			"name":       tool.Name,
			"provider":   tool.Provider,
			"params":     tool.Params,
			"enabled":    tool.Enabled,
			"updated_at": now,
		})

	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, gorm.ErrRecordNotFound
	}

	return s.GetTool(ctx, userID, tool.ID)
}

func (s *Storage) DeleteTool(ctx context.Context, userID, toolID uuid.UUID) error {
	result := s.DB.WithContext(ctx).
		Where("id = ? AND user_id = ?", toolID, userID).
		Delete(&Tool{})

	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}

	return nil
}

func (s *Storage) GetToolsByProvider(ctx context.Context, provider string) ([]Tool, error) {
	var result []Tool

	if err := s.DB.WithContext(ctx).
		Where("provider = ? AND enabled = ?", provider, true).
		Find(&result).Error; err != nil {
		return nil, err
	}

	return result, nil
}
