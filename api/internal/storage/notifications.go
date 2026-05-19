package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
)

func (s *Storage) CreateNotification(ctx context.Context, n *Notification) error {
	n.ID = uuid.New()
	n.CreatedAt = time.Now()
	return s.DB.WithContext(ctx).Create(n).Error
}

func (s *Storage) ListPendingDue(ctx context.Context, before time.Time) ([]Notification, error) {
	var notifications []Notification
	err := s.DB.WithContext(ctx).
		Where("fired_at IS NULL AND scheduled_at <= ?", before).
		Find(&notifications).Error
	return notifications, err
}

func (s *Storage) MarkFired(ctx context.Context, id uuid.UUID) error {
	now := time.Now()
	return s.DB.WithContext(ctx).
		Model(&Notification{}).
		Where("id = ?", id).
		Update("fired_at", now).Error
}

func (s *Storage) CancelNotification(ctx context.Context, id, userID uuid.UUID) error {
	return s.DB.WithContext(ctx).
		Where("id = ? AND user_id = ? AND fired_at IS NULL", id, userID).
		Delete(&Notification{}).Error
}

func (s *Storage) ListNotificationsForUser(ctx context.Context, userID uuid.UUID) ([]Notification, error) {
	var notifications []Notification
	err := s.DB.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("scheduled_at DESC").
		Limit(50).
		Find(&notifications).Error
	return notifications, err
}

func (s *Storage) UpsertDevice(ctx context.Context, d *UserDevice) error {
	d.ID = uuid.New()
	d.CreatedAt = time.Now()
	return s.DB.WithContext(ctx).
		Where(UserDevice{UserID: d.UserID, DeviceToken: d.DeviceToken}).
		FirstOrCreate(d).Error
}

func (s *Storage) DeleteDevice(ctx context.Context, token string, userID uuid.UUID) error {
	return s.DB.WithContext(ctx).
		Where("device_token = ? AND user_id = ?", token, userID).
		Delete(&UserDevice{}).Error
}

func (s *Storage) DeviceTokensForUser(ctx context.Context, userID uuid.UUID) ([]string, error) {
	var devices []UserDevice
	if err := s.DB.WithContext(ctx).
		Where("user_id = ?", userID).
		Find(&devices).Error; err != nil {
		return nil, err
	}
	tokens := make([]string, len(devices))
	for i, d := range devices {
		tokens[i] = d.DeviceToken
	}
	return tokens, nil
}
