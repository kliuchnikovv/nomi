package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/nomi-api/internal/storage"
	"go.uber.org/zap"
)

// MemoriesHandler handles REST operations for agent memories.
type MemoriesHandler struct {
	store  *storage.Storage
	logger *zap.Logger
}

// NewMemoriesHandler creates a new MemoriesHandler.
func NewMemoriesHandler(store *storage.Storage, logger *zap.Logger) *MemoriesHandler {
	return &MemoriesHandler{
		store:  store,
		logger: logger,
	}
}

// memoryRow is used to scan the raw DB row. Agno stores:
//   - memory_id: primary key (text)
//   - memory: JSONB column holding a JSON string literal — extracted with #>> '{}'
//   - created_at / updated_at: BigInteger (Unix epoch seconds)
type memoryRow struct {
	MemoryID  string `gorm:"column:memory_id"`
	Memory    string `gorm:"column:memory"`
	CreatedAt int64  `gorm:"column:created_at"`
	UpdatedAt int64  `gorm:"column:updated_at"`
}

// memoryEntry is the API response shape for a single agent memory.
type memoryEntry struct {
	ID        string    `json:"id"`
	Memory    string    `json:"memory"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// GetMemories returns all agno_memories rows for the authenticated user.
// GET /api/user/memories
func (h *MemoriesHandler) GetMemories(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	userIDStr := userID.String()

	var rows []memoryRow
	if err := h.store.DB.WithContext(c.Request.Context()).
		Raw(
			// Agno stores its tables in the 'ai' schema (PostgresDb default).
			// memory column is JSONB containing a raw JSON string; #>> '{}' extracts it as text.
			// created_at / updated_at are BigInteger Unix epoch seconds.
			"SELECT memory_id, memory #>> '{}' AS memory, created_at, updated_at FROM ai.agno_memories WHERE user_id = ? ORDER BY created_at DESC",
			userIDStr,
		).
		Scan(&rows).Error; err != nil {
		h.logger.Error("failed to fetch memories",
			zap.String("user_id", userIDStr),
			zap.Error(err),
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch memories"})
		return
	}

	entries := make([]memoryEntry, 0, len(rows))
	for _, r := range rows {
		entries = append(entries, memoryEntry{
			ID:        r.MemoryID,
			Memory:    r.Memory,
			CreatedAt: time.Unix(r.CreatedAt, 0).UTC(),
			UpdatedAt: time.Unix(r.UpdatedAt, 0).UTC(),
		})
	}

	c.JSON(http.StatusOK, entries)
}

// DeleteMemory deletes a single agno_memories row by memory_id (ownership verified).
// DELETE /api/user/memories/:id
func (h *MemoriesHandler) DeleteMemory(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	memID := c.Param("id")

	result := h.store.DB.WithContext(c.Request.Context()).
		Exec("DELETE FROM ai.agno_memories WHERE memory_id = ? AND user_id = ?", memID, userID.String())
	if result.Error != nil {
		h.logger.Error("failed to delete memory",
			zap.String("user_id", userID.String()),
			zap.String("memory_id", memID),
			zap.Error(result.Error),
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete memory"})
		return
	}

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "memory not found"})
		return
	}

	c.Status(http.StatusNoContent)
}
