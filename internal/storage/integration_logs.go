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
