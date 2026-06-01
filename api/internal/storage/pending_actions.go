package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// EnqueuePendingAction inserts a queued client action. CallID is unique; a
// conflicting insert (same call_id) is ignored so retries are idempotent.
func (s *Storage) EnqueuePendingAction(ctx context.Context, a *PendingClientAction) (*PendingClientAction, error) {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	a.CreatedAt = time.Now().UTC()
	if a.Status == "" {
		a.Status = "pending"
	}
	if err := s.DB.WithContext(ctx).Create(a).Error; err != nil {
		return nil, err
	}
	return a, nil
}

// ListPendingActionsForUser returns the user's actions that are still pending
// and not yet expired, oldest first.
func (s *Storage) ListPendingActionsForUser(ctx context.Context, userID uuid.UUID) ([]*PendingClientAction, error) {
	var actions []*PendingClientAction
	now := time.Now().UTC()
	err := s.DB.WithContext(ctx).
		Where("user_id = ? AND status = ? AND (expires_at IS NULL OR expires_at > ?)", userID, "pending", now).
		Order("created_at ASC").
		Find(&actions).Error
	return actions, err
}

// GetPendingActionByCallID returns a single queued action by its call_id.
func (s *Storage) GetPendingActionByCallID(ctx context.Context, callID string) (*PendingClientAction, error) {
	var a PendingClientAction
	if err := s.DB.WithContext(ctx).First(&a, "call_id = ?", callID).Error; err != nil {
		return nil, err
	}
	return &a, nil
}

// MarkPendingActionResult records the outcome of a queued action. It only
// transitions rows still in 'pending' state, so a late duplicate result cannot
// overwrite an already-finalized action. Returns the number of rows updated.
func (s *Storage) MarkPendingActionResult(ctx context.Context, callID, status, result string) (int64, error) {
	now := time.Now().UTC()
	res := s.DB.WithContext(ctx).
		Model(&PendingClientAction{}).
		Where("call_id = ? AND status = ?", callID, "pending").
		Updates(map[string]interface{}{
			"status":       status,
			"result":       result,
			"delivered_at": now,
		})
	return res.RowsAffected, res.Error
}

// ExpireStalePendingActions flips pending actions whose expires_at has passed to
// the 'expired' state so they are not drained later. Returns rows affected.
func (s *Storage) ExpireStalePendingActions(ctx context.Context) (int64, error) {
	now := time.Now().UTC()
	res := s.DB.WithContext(ctx).
		Model(&PendingClientAction{}).
		Where("status = ? AND expires_at IS NOT NULL AND expires_at <= ?", "pending", now).
		Update("status", "expired")
	return res.RowsAffected, res.Error
}
