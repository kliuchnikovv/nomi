package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

// EntitiesHandler handles REST operations for Agno entity memories.
type EntitiesHandler struct {
	store  *storage.Storage
	logger *zap.Logger
}

// NewEntitiesHandler creates a new EntitiesHandler.
func NewEntitiesHandler(store *storage.Storage, logger *zap.Logger) *EntitiesHandler {
	return &EntitiesHandler{store: store, logger: logger}
}

// entityRow scans a row from ai.agno_learnings.
type entityRow struct {
	ID        string `gorm:"column:id"`
	Content   []byte `gorm:"column:content"`
	CreatedAt int64  `gorm:"column:created_at"`
	UpdatedAt int64  `gorm:"column:updated_at"`
}

// entityContent mirrors the EntityMemory JSON stored in the content column.
type entityContent struct {
	EntityID      string               `json:"entity_id"`
	EntityType    string               `json:"entity_type"`
	Name          string               `json:"name"`
	Description   string               `json:"description"`
	Properties    map[string]string    `json:"properties"`
	Facts         []entityFact         `json:"facts"`
	Events        []entityEvent        `json:"events"`
	Relationships []entityRelationship `json:"relationships"`
}

type entityFact struct {
	ID         string  `json:"id"`
	Content    string  `json:"content"`
	Confidence float64 `json:"confidence,omitempty"`
}

type entityEvent struct {
	ID      string `json:"id"`
	Content string `json:"content"`
	Date    string `json:"date,omitempty"`
}

type entityRelationship struct {
	EntityID string `json:"entity_id"`
	Relation string `json:"relation"`
}

// EntityEntry is the API response shape for a single entity memory.
type EntityEntry struct {
	ID            string               `json:"id"`
	EntityID      string               `json:"entity_id"`
	EntityType    string               `json:"entity_type"`
	Name          string               `json:"name,omitempty"`
	Description   string               `json:"description,omitempty"`
	Properties    map[string]string    `json:"properties,omitempty"`
	Facts         []entityFact         `json:"facts,omitempty"`
	Events        []entityEvent        `json:"events,omitempty"`
	Relationships []entityRelationship `json:"relationships,omitempty"`
	CreatedAt     time.Time            `json:"created_at"`
	UpdatedAt     time.Time            `json:"updated_at"`
}

// GetEntities returns all Agno entity memories for the authenticated user.
// GET /api/user/entities
func (h *EntitiesHandler) GetEntities(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	namespace := fmt.Sprintf("user:%s:personal", userID.String())

	var rows []entityRow
	if err := h.store.DB.WithContext(c.Request.Context()).
		Raw(
			"SELECT id, content, created_at, updated_at FROM ai.agno_learnings WHERE learning_type = 'entity_memory' AND namespace = ? ORDER BY updated_at DESC NULLS LAST",
			namespace,
		).
		Scan(&rows).Error; err != nil {
		h.logger.Error("failed to fetch entities",
			zap.String("user_id", userID.String()),
			zap.Error(err),
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch entities"})
		return
	}

	entries := make([]EntityEntry, 0, len(rows))
	for _, r := range rows {
		var content entityContent
		if err := json.Unmarshal(r.Content, &content); err != nil {
			h.logger.Warn("failed to parse entity content",
				zap.String("id", r.ID),
				zap.Error(err),
			)
			continue
		}
		entries = append(entries, EntityEntry{
			ID:            r.ID,
			EntityID:      content.EntityID,
			EntityType:    content.EntityType,
			Name:          content.Name,
			Description:   content.Description,
			Properties:    content.Properties,
			Facts:         content.Facts,
			Events:        content.Events,
			Relationships: content.Relationships,
			CreatedAt:     time.Unix(r.CreatedAt, 0).UTC(),
			UpdatedAt:     time.Unix(r.UpdatedAt, 0).UTC(),
		})
	}

	c.JSON(http.StatusOK, entries)
}
