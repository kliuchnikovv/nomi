package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// CreateAgentTask inserts a new task. ID/timestamps are set if unset.
func (s *Storage) CreateAgentTask(ctx context.Context, t *AgentTask) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	now := time.Now()
	if t.CreatedAt.IsZero() {
		t.CreatedAt = now
	}
	t.UpdatedAt = now
	return s.DB.WithContext(ctx).Create(t).Error
}

// ListAgentTasksForUser returns the user's background tasks, most recent first.
// Synchronous delegations (background=false) are persisted for audit/chat
// linkage but excluded here so they don't clutter the Tasks screen.
func (s *Storage) ListAgentTasksForUser(ctx context.Context, userID uuid.UUID) ([]AgentTask, error) {
	var tasks []AgentTask
	err := s.DB.WithContext(ctx).
		Where("user_id = ? AND background = ?", userID, true).
		Order("created_at DESC").
		Limit(100).
		Find(&tasks).Error
	return tasks, err
}

// GetAgentTask fetches a single task scoped to the owning user.
func (s *Storage) GetAgentTask(ctx context.Context, id, userID uuid.UUID) (*AgentTask, error) {
	var t AgentTask
	if err := s.DB.WithContext(ctx).
		First(&t, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

// GetAgentTaskByID fetches a task without user scoping. For trusted internal
// writers only (e.g. the AgentTaskListener persisting runner events).
func (s *Storage) GetAgentTaskByID(ctx context.Context, id uuid.UUID) (*AgentTask, error) {
	var t AgentTask
	if err := s.DB.WithContext(ctx).First(&t, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

// UpdateAgentTask applies a partial update (status/plan/result/finished_at) and
// bumps updated_at. Called by the runner as the task progresses.
func (s *Storage) UpdateAgentTask(ctx context.Context, id uuid.UUID, updates map[string]interface{}) error {
	updates["updated_at"] = time.Now()
	return s.DB.WithContext(ctx).
		Model(&AgentTask{}).
		Where("id = ?", id).
		Updates(updates).Error
}

// AppendAgentTaskEvent inserts a progress event. Seq should be monotonic per task.
func (s *Storage) AppendAgentTaskEvent(ctx context.Context, e *AgentTaskEvent) error {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now()
	}
	return s.DB.WithContext(ctx).Create(e).Error
}

// ListAgentTaskEvents returns a task's events in order. The task is verified to
// belong to the user before its events are returned.
func (s *Storage) ListAgentTaskEvents(ctx context.Context, taskID, userID uuid.UUID) ([]AgentTaskEvent, error) {
	if _, err := s.GetAgentTask(ctx, taskID, userID); err != nil {
		return nil, err
	}
	var events []AgentTaskEvent
	err := s.DB.WithContext(ctx).
		Where("task_id = ?", taskID).
		Order("seq ASC").
		Find(&events).Error
	return events, err
}
