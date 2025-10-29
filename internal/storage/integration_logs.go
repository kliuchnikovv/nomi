package storage

import (
	"encoding/json"
	"time"
)

type IntegrationLog struct {
	ID        int64           `db:"id"`
	ProfileID string          `db:"profile_id"`
	Provider  string          `db:"provider"`
	AgentID   string          `db:"agent_id"`
	Action    string          `db:"action"`
	Timestamp time.Time       `db:"timestamp"`
	Details   json.RawMessage `db:"details"`
}

func (s *Storage) SaveIntegrationLog(log *IntegrationLog) error {
	_, err := s.DB.Exec(`
		INSERT INTO integration_logs (profile_id, provider, agent_id, action, timestamp, details)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, log.ProfileID, log.Provider, log.AgentID, log.Action, log.Timestamp, log.Details)
	return err
}
