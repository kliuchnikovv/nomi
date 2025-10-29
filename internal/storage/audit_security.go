package storage

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type AuditSecurity struct {
	ID        int64           `db:"id"`
	ProfileID string          `db:"profile_id"`
	Provider  string          `db:"provider"`
	Action    string          `db:"action"`
	TokenID   uuid.UUID       `db:"token_id"`
	At        time.Time       `db:"at"`
	Meta      json.RawMessage `db:"meta"`
}

func (s *Storage) SaveAuditSecurity(audit *AuditSecurity) error {
	_, err := s.DB.Exec(`
		INSERT INTO audit_security (profile_id, provider, action, token_id, meta)
		VALUES ($1, $2, $3, $4, $5)
	`, audit.ProfileID, audit.Provider, audit.Action, audit.TokenID, audit.Meta)
	return err
}
