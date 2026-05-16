package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// PlanDocument represents a daily plan document in the database.
type PlanDocument struct {
	ID        uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID    uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex:idx_plan_documents_user_date_unique,priority:1"`
	Date      string         `gorm:"type:date;not null;uniqueIndex:idx_plan_documents_user_date_unique,priority:2"`
	Items     datatypes.JSON `gorm:"type:jsonb;not null;default:'[]'"`
	CreatedAt time.Time      `gorm:"not null"`
	UpdatedAt time.Time      `gorm:"not null"`
}

// BeforeCreate ensures a UUID is set before inserting a new PlanDocument.
func (p *PlanDocument) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}

// GetPlanDocument retrieves a plan document for a user on a given date (YYYY-MM-DD).
func (s *Storage) GetPlanDocument(ctx context.Context, userID uuid.UUID, date string) (*PlanDocument, error) {
	var doc PlanDocument
	err := s.DB.WithContext(ctx).
		Where("user_id = ? AND date = ?", userID, date).
		First(&doc).Error
	if err != nil {
		return nil, err
	}
	return &doc, nil
}

// CreatePlanDocument inserts a new plan document.
func (s *Storage) CreatePlanDocument(ctx context.Context, doc *PlanDocument) (*PlanDocument, error) {
	doc.CreatedAt = time.Now()
	doc.UpdatedAt = time.Now()
	if err := s.DB.WithContext(ctx).Create(doc).Error; err != nil {
		return nil, err
	}
	return doc, nil
}

// UpdatePlanDocumentItems replaces the items field of an existing plan document.
func (s *Storage) UpdatePlanDocumentItems(ctx context.Context, id uuid.UUID, userID uuid.UUID, items datatypes.JSON) (*PlanDocument, error) {
	result := s.DB.WithContext(ctx).
		Model(&PlanDocument{}).
		Where("id = ? AND user_id = ?", id, userID).
		Updates(map[string]interface{}{
			"items":      items,
			"updated_at": time.Now(),
		})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, gorm.ErrRecordNotFound
	}

	var doc PlanDocument
	if err := s.DB.WithContext(ctx).First(&doc, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &doc, nil
}
