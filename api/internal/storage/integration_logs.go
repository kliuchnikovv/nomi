package storage

import (
	"encoding/json"
	"time"
)

type IntegrationLog struct {
	ID        int64           `gorm:"primaryKey;autoIncrement"`
	ProfileID string          `gorm:"index;type:text"`
	Provider  string          `gorm:"type:text"`
	AgentID   string          `gorm:"type:text"`
	Action    string          `gorm:"type:text"`
	Timestamp time.Time       `gorm:"column:timestamp"`
	Details   json.RawMessage `gorm:"type:jsonb"`
}

func (s *Storage) SaveIntegrationLog(log *IntegrationLog) error {
    return s.DB.Create(log).Error
}

// ListIntegrationLogs returns recent logs filtered by profile and provider
func (s *Storage) ListIntegrationLogs(profileID, provider string, limit int) ([]IntegrationLog, error) {
    var out []IntegrationLog
    q := s.DB
    if profileID != "" {
        q = q.Where("profile_id = ?", profileID)
    }
    if provider != "" {
        q = q.Where("provider = ?", provider)
    }
    if limit <= 0 || limit > 500 {
        limit = 50
    }
    if err := q.Order("timestamp DESC").Limit(limit).Find(&out).Error; err != nil {
        return nil, err
    }
    return out, nil
}
