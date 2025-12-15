package storage

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type AuditSecurity struct {
	ID        int64           `gorm:"primaryKey;autoIncrement"`
	ProfileID string          `gorm:"index;type:text"`
	Provider  string          `gorm:"type:text"`
	Action    string          `gorm:"type:text"`
	TokenID   uuid.UUID       `gorm:"type:uuid"`
	At        time.Time       `gorm:"column:at"`
	Meta      json.RawMessage `gorm:"type:jsonb"`
}

func (s *Storage) SaveAuditSecurity(audit *AuditSecurity) error {
	if audit.At.IsZero() {
		audit.At = time.Now()
	}
	return s.DB.Create(audit).Error
}
