package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm/clause"
)

type BotIdentity struct {
	UserID       uuid.UUID `json:"user_id" gorm:"type:uuid;primary_key"`
	Name         string    `json:"name" gorm:"size:100;not null;default:'Souper'"`
	Instructions string    `json:"instructions" gorm:"type:text;not null;default:''"`
	Tone         string    `json:"tone" gorm:"size:20;not null;default:'casual'"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// GetBotIdentity returns the user's bot identity, or a default if none is set.
func (s *Storage) GetBotIdentity(ctx context.Context, userID uuid.UUID) (*BotIdentity, error) {
	var identity BotIdentity
	result := s.DB.WithContext(ctx).First(&identity, "user_id = ?", userID)
	if result.Error != nil {
		return &BotIdentity{
			UserID:       userID,
			Name:         "Souper",
			Instructions: "",
			Tone:         "casual",
			UpdatedAt:    time.Now().UTC(),
		}, nil
	}
	return &identity, nil
}

// UpsertBotIdentity creates or updates the user's bot identity.
func (s *Storage) UpsertBotIdentity(ctx context.Context, identity *BotIdentity) error {
	identity.UpdatedAt = time.Now().UTC()
	return s.DB.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"name", "instructions", "tone", "updated_at"}),
	}).Create(identity).Error
}
