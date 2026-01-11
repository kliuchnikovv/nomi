package storage

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// Methods for Project and ProjectTask are kept here while models are in models.go

// CreateProject creates a new project
func (s *Storage) CreateProject(ctx context.Context, project *Project) error {
	return s.DB.WithContext(ctx).Create(project).Error
}

// CreateProjectTask creates a new project task
func (s *Storage) CreateProjectTask(ctx context.Context, task *ProjectTask) error {
	return s.DB.WithContext(ctx).Create(task).Error
}

// GetProjectTask retrieves a task by ID
func (s *Storage) GetProjectTask(ctx context.Context, id uuid.UUID) (*ProjectTask, error) {
	var task ProjectTask
	if err := s.DB.WithContext(ctx).First(&task, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &task, nil
}

// UpdateProjectTaskStatus updates the status of a project task
func (s *Storage) UpdateProjectTaskStatus(ctx context.Context, id uuid.UUID, status ProjectTaskStatus, artifacts []byte) error {
	updates := map[string]interface{}{
		"status":     status,
		"updated_at": time.Now().UTC(),
	}
	if artifacts != nil {
		updates["artifacts"] = artifacts
	}
	result := s.DB.WithContext(ctx).Model(&ProjectTask{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("task not found")
	}
	return nil
}

// GetProjects retrieves all projects for a user
func (s *Storage) GetProjects(ctx context.Context, userID uuid.UUID) ([]Project, error) {
	var projects []Project
	if err := s.DB.WithContext(ctx).Where("user_id = ?", userID).Find(&projects).Error; err != nil {
		return nil, err
	}
	return projects, nil
}

// GetProject retrieves a project by ID
func (s *Storage) GetProject(ctx context.Context, id uuid.UUID) (*Project, error) {
	var project Project
	if err := s.DB.WithContext(ctx).First(&project, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &project, nil
}

// UpdateProject updates a project
func (s *Storage) UpdateProject(ctx context.Context, project *Project) error {
	return s.DB.WithContext(ctx).Save(project).Error
}

// DeleteProject deletes a project (soft delete)
func (s *Storage) DeleteProject(ctx context.Context, id uuid.UUID) error {
	return s.DB.WithContext(ctx).Delete(&Project{}, id).Error
}

// UpdateProjectStatus updates only the status and last_indexed_at fields
func (s *Storage) UpdateProjectStatus(ctx context.Context, id uuid.UUID, status ProjectStatus) error {
	updates := map[string]interface{}{
		"status":     status,
		"updated_at": time.Now().UTC(),
	}
	if status == ProjectStatusReady {
		now := time.Now().UTC()
		updates["last_indexed_at"] = &now
	}
	return s.DB.WithContext(ctx).Model(&Project{}).Where("id = ?", id).Updates(updates).Error
}

// GetProjectTasks retrieves all tasks for a project
func (s *Storage) GetProjectTasks(ctx context.Context, projectID uuid.UUID) ([]ProjectTask, error) {
	var tasks []ProjectTask
	if err := s.DB.WithContext(ctx).Where("project_id = ?", projectID).Find(&tasks).Error; err != nil {
		return nil, err
	}
	return tasks, nil
}

// UpdateProjectTask updates a project task
func (s *Storage) UpdateProjectTask(ctx context.Context, task *ProjectTask) error {
	return s.DB.WithContext(ctx).Save(task).Error
}

// DeleteProjectTask deletes a project task (soft delete)
func (s *Storage) DeleteProjectTask(ctx context.Context, id uuid.UUID) error {
	return s.DB.WithContext(ctx).Delete(&ProjectTask{}, id).Error
}
