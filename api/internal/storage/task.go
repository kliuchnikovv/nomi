package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Methods for Task are kept here while models are in models.go

// CreateTask creates a new task
func (s *Storage) CreateTask(ctx context.Context, task *Task) error {
	return s.DB.WithContext(ctx).Create(task).Error
}

// GetDueTasks returns tasks that are ready to be executed
func (s *Storage) GetDueTasks(ctx context.Context) ([]Task, error) {
	var tasks []Task
	if err := s.DB.WithContext(ctx).
		Where("status = ? AND execute_at <= ?", TaskStatusPending, time.Now().UTC()).
		Find(&tasks).Error; err != nil {
		return nil, err
	}
	return tasks, nil
}

// UpdateTaskStatus updates the status of a task
func (s *Storage) UpdateTaskStatus(ctx context.Context, id uuid.UUID, status TaskStatus, errMessage string) error {
	updates := map[string]interface{}{
		"status":     status,
		"updated_at": time.Now().UTC(),
	}
	if errMessage != "" {
		updates["error"] = errMessage
	}
	return s.DB.WithContext(ctx).Model(&Task{}).Where("id = ?", id).Updates(updates).Error
}

// RescheduleTask updates the task for the next run (for recurring tasks)
func (s *Storage) RescheduleTask(ctx context.Context, id uuid.UUID, nextRun time.Time) error {
	return s.DB.WithContext(ctx).Model(&Task{}).Where("id = ?", id).Updates(map[string]interface{}{
		"execute_at": nextRun,
		"status":     TaskStatusPending,
		"updated_at": time.Now().UTC(),
	}).Error
}
