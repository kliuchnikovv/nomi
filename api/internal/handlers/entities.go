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

// EntitiesHandler handles REST operations for Agno entity memory.
type EntitiesHandler struct {
	store  *storage.Storage
	logger *zap.Logger
}

// NewEntitiesHandler creates a new EntitiesHandler.
func NewEntitiesHandler(store *storage.Storage, logger *zap.Logger) *EntitiesHandler {
	return &EntitiesHandler{
		store:  store,
		logger: logger,
	}
}

// entityRow is used to scan a raw DB row from ai.agno_learnings.
type entityRow struct {
	ID        string  `gorm:"column:id"`
	Content   string  `gorm:"column:content"`
	CreatedAt *string `gorm:"column:created_at"`
	UpdatedAt *string `gorm:"column:updated_at"`
}

// entityContent is the parsed shape of the JSONB content column.
type entityContent struct {
	Entity  string `json:"entity"`
	Summary string `json:"summary"`
}

// EntityEntry is the API response shape for a single entity memory.
type EntityEntry struct {
	ID        string    `json:"id"`
	Entity    string    `json:"entity"`
	Summary   string    `json:"summary"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// GetEntities returns all entity_memory rows from ai.agno_learnings for the authenticated user.
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
		h.logger.Error("failed to fetch entity memories",
			zap.String("user_id", userID.String()),
			zap.Error(err),
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch entity memories"})
		return
	}

	entries := make([]EntityEntry, 0, len(rows))
	for _, r := range rows {
		var content entityContent
		if err := json.Unmarshal([]byte(r.Content), &content); err != nil {
			h.logger.Warn("failed to parse entity content",
				zap.String("id", r.ID),
				zap.Error(err),
			)
			continue
		}

		entry := EntityEntry{
			ID:      r.ID,
			Entity:  content.Entity,
			Summary: content.Summary,
		}

		if r.CreatedAt != nil {
			if t, err := time.Parse(time.RFC3339, *r.CreatedAt); err == nil {
				entry.CreatedAt = t.UTC()
			}
		}
		if r.UpdatedAt != nil {
			if t, err := time.Parse(time.RFC3339, *r.UpdatedAt); err == nil {
				entry.UpdatedAt = t.UTC()
			}
		}

		entries = append(entries, entry)
	}

	c.JSON(http.StatusOK, entries)
}
