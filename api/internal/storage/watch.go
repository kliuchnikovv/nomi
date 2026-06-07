package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// CreateWatchReminder inserts a new WatchReminder row and returns the persisted record.
func (s *Storage) CreateWatchReminder(ctx context.Context, w *WatchReminder) (*WatchReminder, error) {
	if w.ID == uuid.Nil {
		w.ID = uuid.New()
	}
	w.CreatedAt = time.Now().UTC()
	if w.State == "" {
		w.State = "pending"
	}
	if err := s.DB.WithContext(ctx).Create(w).Error; err != nil {
		return nil, err
	}
	return w, nil
}

// ListDueWatchReminders returns up to limit watch reminders in state "pending"
// whose fire_at is in the past.
func (s *Storage) ListDueWatchReminders(ctx context.Context, now time.Time, limit int) ([]*WatchReminder, error) {
	var rows []*WatchReminder
	err := s.DB.WithContext(ctx).
		Where("state = ? AND fire_at <= ?", "pending", now.UTC()).
		Order("fire_at ASC").
		Limit(limit).
		Find(&rows).Error
	return rows, err
}

// MarkWatchFired flips a watch reminder to "fired" and stamps fired_at.
func (s *Storage) MarkWatchFired(ctx context.Context, id uuid.UUID) error {
	return s.DB.WithContext(ctx).
		Model(&WatchReminder{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"state":    "fired",
			"fired_at": time.Now().UTC(),
		}).Error
}

// ListWatchReminders returns a user's active (pending) watch reminders, soonest first.
func (s *Storage) ListWatchReminders(ctx context.Context, userID uuid.UUID) ([]*WatchReminder, error) {
	var rows []*WatchReminder
	err := s.DB.WithContext(ctx).
		Where("user_id = ? AND state = ?", userID, "pending").
		Order("fire_at ASC").
		Find(&rows).Error
	return rows, err
}

// CancelWatchReminder marks a user's pending watch reminder as cancelled.
// Scoped by user_id so a user can only cancel their own reminders.
func (s *Storage) CancelWatchReminder(ctx context.Context, userID, id uuid.UUID) error {
	return s.DB.WithContext(ctx).
		Model(&WatchReminder{}).
		Where("id = ? AND user_id = ? AND state = ?", id, userID, "pending").
		Update("state", "cancelled").Error
}
