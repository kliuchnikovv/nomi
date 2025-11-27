package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func (s *Storage) AddIntegrations(ctx context.Context, userID uuid.UUID, integrations ...Integration) error {
	for i := range integrations {
		if _, err := s.CreateIntegration(ctx, userID, &integrations[i]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Storage) CreateIntegration(ctx context.Context, userID uuid.UUID, integration *Integration) (*Integration, error) {
	now := time.Now().UTC()
	stored := &Integration{
		ID:        integration.ID,
		UserID:    userID,
		Name:      integration.Name,
		Provider:  integration.Provider,
		Params:    integration.Params,
		Enabled:   integration.Enabled,
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

func (s *Storage) GetIntegrations(ctx context.Context, userID uuid.UUID) ([]Integration, error) {
	var result []Integration

	if err := s.DB.WithContext(ctx).
		Where("user_id = ?", userID).
		Find(&result).Error; err != nil {
		return nil, err
	}

	return result, nil
}

func (s *Storage) GetIntegration(ctx context.Context, userID, integrationID uuid.UUID) (*Integration, error) {
	var integration Integration
	if err := s.DB.WithContext(ctx).
		Where("id = ? AND user_id = ?", integrationID, userID).
		First(&integration).Error; err != nil {
		return nil, err
	}

	return &integration, nil
}

func (s *Storage) UpdateIntegration(ctx context.Context, userID uuid.UUID, integration *Integration) (*Integration, error) {
	now := time.Now().UTC()
	result := s.DB.WithContext(ctx).Model(&Integration{}).
		Where("id = ? AND user_id = ?", integration.ID, userID).
		Updates(map[string]any{
			"name":       integration.Name,
			"provider":   integration.Provider,
			"params":     integration.Params,
			"enabled":    integration.Enabled,
			"updated_at": now,
		})

	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, gorm.ErrRecordNotFound
	}

	return s.GetIntegration(ctx, userID, integration.ID)
}

func (s *Storage) DeleteIntegration(ctx context.Context, userID, integrationID uuid.UUID) error {
	result := s.DB.WithContext(ctx).
		Where("id = ? AND user_id = ?", integrationID, userID).
		Delete(&Integration{})

	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}

	return nil
}

func (s *Storage) GetIntegrationsByProvider(ctx context.Context, provider string) ([]Integration, error) {
	var result []Integration

	if err := s.DB.WithContext(ctx).
		Where("provider = ? AND enabled = ?", provider, true).
		Find(&result).Error; err != nil {
		return nil, err
	}

	return result, nil
}
