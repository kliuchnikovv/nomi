package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

// TaskStatus defines the state of a task
type TaskStatus string

const (
	TaskStatusPending   TaskStatus = "pending"
	TaskStatusRunning   TaskStatus = "running"
	TaskStatusCompleted TaskStatus = "completed"
	TaskStatusFailed    TaskStatus = "failed"
)

// Task represents a scheduled job
type Task struct {
	ID        uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID    uuid.UUID      `gorm:"type:uuid;not null"`
	ChatID    uuid.UUID      `gorm:"type:uuid;not null"`
	Type      string         `gorm:"type:varchar(50);not null"` // e.g. "agent_message"
	Payload   datatypes.JSON `gorm:"type:jsonb;not null"`       // e.g. {"message": "check news"}
	CronExpr  string         `gorm:"type:varchar(50)"`          // Optional cron expression
	ExecuteAt time.Time      `gorm:"not null"`
	Status    TaskStatus     `gorm:"type:varchar(20);default:'pending';not null"`
	Error     string         `gorm:"type:text"`
	CreatedAt time.Time      `gorm:"not null"`
	UpdatedAt time.Time      `gorm:"not null"`
}

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
