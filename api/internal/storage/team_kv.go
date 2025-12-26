package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

// TeamKVStore represents a key-value store for team state, scoped to a room (chat)
type TeamKVStore struct {
	ID        uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	RoomID    uuid.UUID      `gorm:"type:uuid;not null;index"`
	TeamID    string         `gorm:"type:text;not null;index"` // "dnd", "dev", etc.
	Key       string         `gorm:"type:text;not null;index"` // "world_state", "party_state"
	Value     datatypes.JSON `gorm:"type:jsonb;not null"`
	CreatedAt time.Time      `gorm:"not null"`
	UpdatedAt time.Time      `gorm:"not null"`
}

// SetTeamState saves or updates a state value
func (s *Storage) SetTeamState(ctx context.Context, roomID uuid.UUID, teamID, key string, value []byte) error {
	var kv TeamKVStore
	err := s.DB.WithContext(ctx).Where("room_id = ? AND team_id = ? AND key = ?", roomID, teamID, key).First(&kv).Error

	if err == nil {
		// Update
		kv.Value = datatypes.JSON(value)
		return s.DB.WithContext(ctx).Save(&kv).Error
	}

	// Create
	kv = TeamKVStore{
		RoomID: roomID,
		TeamID: teamID,
		Key:    key,
		Value:  datatypes.JSON(value),
	}
	return s.DB.WithContext(ctx).Create(&kv).Error
}

// GetTeamState retrieves a state value
func (s *Storage) GetTeamState(ctx context.Context, roomID uuid.UUID, teamID, key string) ([]byte, error) {
	var kv TeamKVStore
	err := s.DB.WithContext(ctx).Where("room_id = ? AND team_id = ? AND key = ?", roomID, teamID, key).First(&kv).Error
	if err != nil {
		return nil, err
	}
	return []byte(kv.Value), nil
}
