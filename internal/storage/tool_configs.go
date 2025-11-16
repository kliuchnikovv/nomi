package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func (s *Storage) CreateToolConfig(ctx context.Context, cfg *ToolConfig) (*ToolConfig, error) {
	now := time.Now().UTC()
	stored := &ToolConfig{
		ID:        cfg.ID,
		Name:      cfg.Name,
		Provider:  cfg.Provider,
		Params:    cfg.Params,
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

func (s *Storage) ListToolConfigs(ctx context.Context) ([]ToolConfig, error) {
	var configs []ToolConfig
	if err := s.DB.WithContext(ctx).Find(&configs).Error; err != nil {
		return nil, err
	}

	return configs, nil
}

func (s *Storage) GetToolConfig(ctx context.Context, id uuid.UUID) (*ToolConfig, error) {
	var cfg ToolConfig
	if err := s.DB.WithContext(ctx).First(&cfg, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (s *Storage) UpdateToolConfig(ctx context.Context, cfg *ToolConfig) (*ToolConfig, error) {
	now := time.Now().UTC()
	result := s.DB.WithContext(ctx).Model(&ToolConfig{}).
		Where("id = ?", cfg.ID).
		Updates(map[string]any{
			"name":       cfg.Name,
			"provider":   cfg.Provider,
			"params":     cfg.Params,
			"updated_at": now,
		})

	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, gorm.ErrRecordNotFound
	}

	return s.GetToolConfig(ctx, cfg.ID)
}

func (s *Storage) DeleteToolConfig(ctx context.Context, id uuid.UUID) error {
	result := s.DB.WithContext(ctx).Where("id = ?", id).Delete(&ToolConfig{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}

	return nil
}
