package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm/clause"
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

// ListUnfinishedAgentTasks returns background tasks that are still in a
// non-terminal state and have not been touched for at least staleAfter. The
// reconcile worker uses this to re-adopt tasks orphaned by a crash/restart.
func (s *Storage) ListUnfinishedAgentTasks(ctx context.Context, staleAfter time.Duration) ([]AgentTask, error) {
	var tasks []AgentTask
	cutoff := time.Now().Add(-staleAfter)
	err := s.DB.WithContext(ctx).
		Where("background = ? AND status IN ? AND updated_at < ?",
			true,
			[]string{"planning", "running", "waiting_input", "paused"},
			cutoff,
		).
		Order("updated_at ASC").
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

// AppendAgentTaskEvent inserts a progress event. Seq should be monotonic per
// task. The insert is idempotent: a re-published event with an existing
// (task_id, seq) is a no-op (ON CONFLICT DO NOTHING), so the runner can safely
// replay after a crash/reconnect.
func (s *Storage) AppendAgentTaskEvent(ctx context.Context, e *AgentTaskEvent) error {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now()
	}
	return s.DB.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "task_id"}, {Name: "seq"}},
			DoNothing: true,
		}).
		Create(e).Error
}

// MaxAgentTaskEventSeq returns the highest event seq for a task (0 if none).
// Used by the reconcile endpoint to report last_seq.
func (s *Storage) MaxAgentTaskEventSeq(ctx context.Context, taskID uuid.UUID) (int, error) {
	var maxSeq *int
	if err := s.DB.WithContext(ctx).
		Model(&AgentTaskEvent{}).
		Where("task_id = ?", taskID).
		Select("MAX(seq)").
		Scan(&maxSeq).Error; err != nil {
		return 0, err
	}
	if maxSeq == nil {
		return 0, nil
	}
	return *maxSeq, nil
}

// ListAgentTaskEventsByTaskID returns all events for a task in seq order,
// without user scoping. For trusted internal callers (reconcile worker).
func (s *Storage) ListAgentTaskEventsByTaskID(ctx context.Context, taskID uuid.UUID) ([]AgentTaskEvent, error) {
	var events []AgentTaskEvent
	err := s.DB.WithContext(ctx).
		Where("task_id = ?", taskID).
		Order("seq ASC").
		Find(&events).Error
	return events, err
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
