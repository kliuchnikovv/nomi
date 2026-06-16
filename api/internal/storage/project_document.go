package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ProjectDocument is a file attached to a project. The raw bytes are parsed,
// chunked and embedded into the vector store (personal_vectors) by the Python
// brain; this row only tracks metadata and indexing status so the UI can list
// documents and remove their vectors. Status: 'indexing' | 'ready' | 'failed'.
type ProjectDocument struct {
	ID         uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	ProjectID  uuid.UUID      `gorm:"type:uuid;not null;index:idx_project_documents_project" json:"project_id"`
	UserID     uuid.UUID      `gorm:"type:uuid;not null;index" json:"user_id"`
	FileName   string         `gorm:"type:text;not null" json:"file_name"`
	FileType   string         `gorm:"type:text;not null" json:"file_type"`
	Size       int64          `gorm:"type:bigint;not null" json:"size"`
	Status     string         `gorm:"type:varchar(20);not null;default:'indexing'" json:"status"`
	ChunkCount int            `gorm:"not null;default:0" json:"chunk_count"`
	Error      string         `gorm:"type:text;not null;default:''" json:"error"`
	CreatedAt  time.Time      `gorm:"not null" json:"created_at"`
	UpdatedAt  time.Time      `gorm:"not null" json:"updated_at"`
	DeletedAt  gorm.DeletedAt `gorm:"index" json:"-"`
}

func (s *Storage) CreateProjectDocument(ctx context.Context, doc *ProjectDocument) error {
	now := time.Now()
	doc.CreatedAt = now
	doc.UpdatedAt = now
	return s.DB.WithContext(ctx).Create(doc).Error
}

func (s *Storage) ListProjectDocuments(ctx context.Context, userID, projectID uuid.UUID) ([]ProjectDocument, error) {
	var docs []ProjectDocument
	if err := s.DB.WithContext(ctx).
		Where("user_id = ? AND project_id = ?", userID, projectID).
		Order("created_at DESC").
		Find(&docs).Error; err != nil {
		return nil, err
	}
	return docs, nil
}

func (s *Storage) GetProjectDocument(ctx context.Context, userID, docID uuid.UUID) (*ProjectDocument, error) {
	var doc ProjectDocument
	if err := s.DB.WithContext(ctx).
		Where("id = ? AND user_id = ?", docID, userID).
		First(&doc).Error; err != nil {
		return nil, err
	}
	return &doc, nil
}

func (s *Storage) UpdateProjectDocumentStatus(ctx context.Context, docID uuid.UUID, status string, chunkCount int, errMsg string) error {
	return s.DB.WithContext(ctx).
		Model(&ProjectDocument{}).
		Where("id = ?", docID).
		Updates(map[string]any{
			"status":      status,
			"chunk_count": chunkCount,
			"error":       errMsg,
			"updated_at":  time.Now(),
		}).Error
}

func (s *Storage) DeleteProjectDocument(ctx context.Context, userID, docID uuid.UUID) error {
	return s.DB.WithContext(ctx).
		Where("id = ? AND user_id = ?", docID, userID).
		Delete(&ProjectDocument{}).Error
}
