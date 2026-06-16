package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// UserAPIKey stores a user-supplied LLM provider API key (BYOK — bring your own
// key). The raw key is encrypted at rest with AES-256-GCM (see internal/crypto)
// using the server's ENCRYPTION_KEY; only the ciphertext is persisted. One row
// per (user, provider). At most one provider per user is marked IsDefault.
type UserAPIKey struct {
	ID           uuid.UUID      `json:"id" gorm:"type:uuid;primaryKey"`
	UserID       uuid.UUID      `json:"user_id" gorm:"type:uuid;uniqueIndex:idx_byok_user_provider"`
	Provider     string         `json:"provider" gorm:"type:text;uniqueIndex:idx_byok_user_provider"`
	KeyEncrypted []byte         `json:"-" gorm:"type:bytea"`
	IsDefault    bool           `json:"is_default" gorm:"default:false"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `json:"-" gorm:"index"`
}

func (UserAPIKey) TableName() string {
	return "user_api_keys"
}

// SaveUserAPIKey upserts the encrypted key for (user, provider). When isDefault
// is true, any other default for that user is cleared in the same transaction so
// exactly one provider stays default.
func (s *Storage) SaveUserAPIKey(ctx context.Context, userID uuid.UUID, provider string, keyEncrypted []byte, isDefault bool) error {
	now := time.Now().UTC()
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if isDefault {
			if err := tx.Model(&UserAPIKey{}).
				Where("user_id = ? AND provider <> ?", userID, provider).
				Update("is_default", false).Error; err != nil {
				return err
			}
		}

		var existing UserAPIKey
		err := tx.Where("user_id = ? AND provider = ?", userID, provider).First(&existing).Error
		if err == nil {
			existing.KeyEncrypted = keyEncrypted
			existing.IsDefault = isDefault
			existing.UpdatedAt = now
			return tx.Save(&existing).Error
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}

		return tx.Create(&UserAPIKey{
			ID:           uuid.New(),
			UserID:       userID,
			Provider:     provider,
			KeyEncrypted: keyEncrypted,
			IsDefault:    isDefault,
			CreatedAt:    now,
			UpdatedAt:    now,
		}).Error
	})
}

// ListUserAPIKeys returns all stored BYOK rows for a user. The ciphertext is
// included (KeyEncrypted is omitted from JSON); the payload-injection path
// decrypts it, while the HTTP handler exposes only provider + is_default.
func (s *Storage) ListUserAPIKeys(ctx context.Context, userID uuid.UUID) ([]UserAPIKey, error) {
	var keys []UserAPIKey
	if err := s.DB.WithContext(ctx).
		Where("user_id = ?", userID).
		Find(&keys).Error; err != nil {
		return nil, err
	}
	return keys, nil
}

// SetDefaultUserAPIKey marks one provider as the user's default and clears the
// flag on all others. Returns gorm.ErrRecordNotFound if the provider has no key.
func (s *Storage) SetDefaultUserAPIKey(ctx context.Context, userID uuid.UUID, provider string) error {
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing UserAPIKey
		if err := tx.Where("user_id = ? AND provider = ?", userID, provider).First(&existing).Error; err != nil {
			return err
		}
		if err := tx.Model(&UserAPIKey{}).
			Where("user_id = ? AND provider <> ?", userID, provider).
			Update("is_default", false).Error; err != nil {
			return err
		}
		return tx.Model(&UserAPIKey{}).
			Where("user_id = ? AND provider = ?", userID, provider).
			Update("is_default", true).Error
	})
}

// DeleteUserAPIKey hard-deletes the BYOK key for a user's provider so a re-add
// does not collide with a soft-deleted row on the unique (user, provider) index.
func (s *Storage) DeleteUserAPIKey(ctx context.Context, userID uuid.UUID, provider string) error {
	return s.DB.WithContext(ctx).Unscoped().
		Where("user_id = ? AND provider = ?", userID, provider).
		Delete(&UserAPIKey{}).Error
}
