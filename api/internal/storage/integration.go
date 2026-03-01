package storage

import (
	"time"

	"github.com/google/uuid"
)

// UpsertIntegration creates a new integration or updates the existing one
// matched by (user_id, provider, account_email). This ensures that multiple
// accounts of the same provider each get their own row.
func (s *Storage) UpsertIntegration(integration *Integration) error {
	var existing Integration
	err := s.DB.Where(
		"user_id = ? AND provider = ? AND account_email = ?",
		integration.UserID,
		integration.Provider,
		integration.AccountEmail,
	).First(&existing).Error

	if err == nil {
		// Row exists — update mutable fields only.
		return s.DB.Model(&existing).Updates(map[string]interface{}{
			"name":       integration.Name,
			"params":     integration.Params,
			"enabled":    integration.Enabled,
			"updated_at": time.Now(),
		}).Error
	}

	// No matching row — create a new one.
	if integration.ID == (uuid.UUID{}) {
		integration.ID = uuid.New()
	}
	return s.DB.Create(integration).Error
}
