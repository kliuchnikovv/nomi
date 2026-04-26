package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
)

func (s *Storage) CreateProject(ctx context.Context, userID uuid.UUID, name, description, icon string) (*Project, error) {
	p := &Project{
		ID:          uuid.New(),
		UserID:      userID,
		Name:        name,
		Description: description,
		Icon:        icon,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	if err := s.DB.WithContext(ctx).Create(p).Error; err != nil {
		return nil, err
	}
	return p, nil
}

func (s *Storage) GetUserProjects(ctx context.Context, userID uuid.UUID) ([]Project, error) {
	var projects []Project
	if err := s.DB.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Find(&projects).Error; err != nil {
		return nil, err
	}
	return projects, nil
}

func (s *Storage) GetProject(ctx context.Context, userID, projectID uuid.UUID) (*Project, error) {
	var p Project
	if err := s.DB.WithContext(ctx).
		Where("id = ? AND user_id = ?", projectID, userID).
		First(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Storage) UpdateProject(ctx context.Context, userID, projectID uuid.UUID, name, description, icon string) (*Project, error) {
	result := s.DB.WithContext(ctx).
		Model(&Project{}).
		Where("id = ? AND user_id = ?", projectID, userID).
		Updates(map[string]any{
			"name":        name,
			"description": description,
			"icon":        icon,
			"updated_at":  time.Now(),
		})
	if result.Error != nil {
		return nil, result.Error
	}
	return s.GetProject(ctx, userID, projectID)
}

func (s *Storage) DeleteProject(ctx context.Context, userID, projectID uuid.UUID) error {
	// Unlink chats before deleting
	if err := s.DB.WithContext(ctx).
		Model(&Chat{}).
		Where("project_id = ? AND user_id = ?", projectID, userID).
		Update("project_id", nil).Error; err != nil {
		return err
	}
	return s.DB.WithContext(ctx).
		Where("id = ? AND user_id = ?", projectID, userID).
		Delete(&Project{}).Error
}

func (s *Storage) CountChatsInProject(ctx context.Context, projectID uuid.UUID) (int64, error) {
	var count int64
	err := s.DB.WithContext(ctx).
		Model(&Chat{}).
		Where("project_id = ?", projectID).
		Count(&count).Error
	return count, err
}
