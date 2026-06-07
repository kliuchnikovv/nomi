package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

// CreateProactiveEvent inserts a new ProactiveEvent row and returns the persisted record.
func (s *Storage) CreateProactiveEvent(ctx context.Context, ev *ProactiveEvent) (*ProactiveEvent, error) {
	if ev.ID == uuid.Nil {
		ev.ID = uuid.New()
	}
	now := time.Now().UTC()
	ev.CreatedAt = now
	if ev.State == "" {
		ev.State = "pending"
	}
	if err := s.DB.WithContext(ctx).Create(ev).Error; err != nil {
		return nil, err
	}
	return ev, nil
}

// GetProactiveEvent returns a single ProactiveEvent by ID.
func (s *Storage) GetProactiveEvent(ctx context.Context, id uuid.UUID) (*ProactiveEvent, error) {
	var ev ProactiveEvent
	if err := s.DB.WithContext(ctx).First(&ev, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &ev, nil
}

// ListPendingDueEvents returns up to limit proactive events that are in state
// "pending" and whose fire_at is either NULL or in the past.
func (s *Storage) ListPendingDueEvents(ctx context.Context, limit int) ([]*ProactiveEvent, error) {
	var events []*ProactiveEvent
	err := s.DB.WithContext(ctx).
		Where("state = ? AND (fire_at IS NULL OR fire_at <= ?)", "pending", time.Now().UTC()).
		Order("created_at ASC").
		Limit(limit).
		Find(&events).Error
	return events, err
}

// UpdateEventState updates the state, optional decision_reason, and processed_at of a
// proactive event. Pass an empty reason string to leave decision_reason unchanged.
func (s *Storage) UpdateEventState(ctx context.Context, id uuid.UUID, state string, reason string) error {
	updates := map[string]interface{}{
		"state": state,
	}
	if reason != "" {
		updates["decision_reason"] = reason
	}
	if state != "pending" {
		now := time.Now().UTC()
		updates["processed_at"] = now
	}
	return s.DB.WithContext(ctx).
		Model(&ProactiveEvent{}).
		Where("id = ?", id).
		Updates(updates).Error
}

// SetEventFireAt defers an event by updating its fire_at timestamp.
// The state is left unchanged (remains "pending") so the scheduler will pick
// it up once the quiet-hours window closes.
func (s *Storage) SetEventFireAt(ctx context.Context, id uuid.UUID, fireAt time.Time) error {
	return s.DB.WithContext(ctx).
		Model(&ProactiveEvent{}).
		Where("id = ?", id).
		Update("fire_at", fireAt).Error
}

// CountSurfacedEventsInWindow returns how many proactive events for a user
// reached the "surfaced" state within the trailing window. Used to rate-cap
// autonomous (device-sourced) events.
func (s *Storage) CountSurfacedEventsInWindow(ctx context.Context, userID uuid.UUID, window time.Duration) (int64, error) {
	cutoff := time.Now().UTC().Add(-window)
	var count int64
	err := s.DB.WithContext(ctx).
		Model(&ProactiveEvent{}).
		Where("user_id = ? AND state = ? AND created_at > ?", userID, "surfaced", cutoff).
		Count(&count).Error
	return count, err
}

// UpdateEventPayload overwrites the JSONB payload of an event (used by tests / corrections).
func (s *Storage) UpdateEventPayload(ctx context.Context, id uuid.UUID, payload datatypes.JSON) error {
	return s.DB.WithContext(ctx).
		Model(&ProactiveEvent{}).
		Where("id = ?", id).
		Update("payload", payload).Error
}
