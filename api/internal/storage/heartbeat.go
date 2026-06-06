package storage

import (
	"context"

	"github.com/google/uuid"
)

// SaveHeartbeat persists a diagnostic heartbeat record.
func (s *Storage) SaveHeartbeat(ctx context.Context, hb *Heartbeat) error {
	return s.DB.WithContext(ctx).Create(hb).Error
}

// ListHeartbeats returns the most recent heartbeats for a user, newest first.
func (s *Storage) ListHeartbeats(ctx context.Context, userID uuid.UUID, limit int) ([]Heartbeat, error) {
	if limit <= 0 {
		limit = 20
	}
	var heartbeats []Heartbeat
	err := s.DB.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("received_at DESC").
		Limit(limit).
		Find(&heartbeats).Error
	return heartbeats, err
}

// CountHeartbeats returns the total number of heartbeats recorded for a user.
func (s *Storage) CountHeartbeats(ctx context.Context, userID uuid.UUID) (int64, error) {
	var count int64
	err := s.DB.WithContext(ctx).
		Model(&Heartbeat{}).
		Where("user_id = ?", userID).
		Count(&count).Error
	return count, err
}
