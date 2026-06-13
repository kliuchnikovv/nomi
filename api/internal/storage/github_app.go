package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm/clause"
)

// SaveGitHubInstallation upserts the GitHub App installation for a user.
// Personal installs are one-per-user, so we key the upsert on UserID.
func (s *Storage) SaveGitHubInstallation(ctx context.Context, inst *GitHubAppInstallation) error {
	now := time.Now().UTC()
	if inst.ID == uuid.Nil {
		inst.ID = uuid.New()
	}
	if inst.CreatedAt.IsZero() {
		inst.CreatedAt = now
	}
	inst.UpdatedAt = now

	return s.DB.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"installation_id", "account_login", "updated_at"}),
	}).Create(inst).Error
}

// GetGitHubInstallationByUser returns the user's installation, or
// gorm.ErrRecordNotFound if they haven't installed the app.
func (s *Storage) GetGitHubInstallationByUser(ctx context.Context, userID uuid.UUID) (*GitHubAppInstallation, error) {
	var inst GitHubAppInstallation
	if err := s.DB.WithContext(ctx).
		Where("user_id = ?", userID).
		First(&inst).Error; err != nil {
		return nil, err
	}
	return &inst, nil
}

// DeleteGitHubInstallationByUser removes a user's installation record (e.g. on
// uninstall). No error if the row doesn't exist.
func (s *Storage) DeleteGitHubInstallationByUser(ctx context.Context, userID uuid.UUID) error {
	return s.DB.WithContext(ctx).
		Where("user_id = ?", userID).
		Delete(&GitHubAppInstallation{}).Error
}
