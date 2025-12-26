package team

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

type Handler struct {
	Store *storage.Storage
}

func NewHandler(store *storage.Storage) *Handler {
	return &Handler{Store: store}
}

type SetStateRequest struct {
	RoomID uuid.UUID `json:"room_id" binding:"required"`
	TeamID string    `json:"team_id" binding:"required"`
	Key    string    `json:"key" binding:"required"`
	Value  any       `json:"value" binding:"required"`
}

func (h *Handler) SetState(c *gin.Context) {
	var req SetStateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// In a real app we'd marshal 'req.Value' to JSON.
	// But 'datatypes.JSON' expects []byte.
	// Since 'value' is 'any', we need to serialize it again or accept raw JSON.
	// Let's accept raw JSON map or object.
	// Actually, easier if we just take the raw body or use json.Marshal

	// Re-marshalling to ensure it's valid JSON bytes
	bytes, err := json.Marshal(req.Value)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json value"})
		return
	}

	if err := h.Store.SetTeamState(c.Request.Context(), req.RoomID, req.TeamID, req.Key, bytes); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusOK)
}

func (h *Handler) GetState(c *gin.Context) {
	roomIDStr := c.Query("room_id")
	teamID := c.Query("team_id")
	key := c.Query("key")

	if roomIDStr == "" || teamID == "" || key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing parameters"})
		return
	}

	roomID, err := uuid.Parse(roomIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid room_id"})
		return
	}

	val, err := h.Store.GetTeamState(c.Request.Context(), roomID, teamID, key)
	if err != nil {
		// Return empty object or null if not found? Or 404?
		// For KV store, null is often better than error.
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	// Write raw JSON
	c.Data(http.StatusOK, "application/json", val)
}
