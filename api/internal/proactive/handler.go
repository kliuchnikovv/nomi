package proactive

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"gorm.io/datatypes"
)

// validSources and validEventTypes are the only accepted enum values.
var validSources = map[string]bool{
	"calendar":  true,
	"email":     true,
	"reminders": true,
	"health":    true,
	"system":    true, // server-generated (e.g. scheduled daily brief)
	"watch":     true, // agent-set self-reminder fired by the scheduler
}

var validEventTypes = map[string]bool{
	"calendar_upcoming": true,
	"email_new":         true,
	"reminder_due":      true,
	"health_anomaly":    true,
	"daily_brief":       true,
	"watch_reminder":    true,
}

// Handler exposes the proactive event ingest HTTP endpoint.
type Handler struct {
	store      *storage.Storage
	dispatcher *Dispatcher
}

// NewHandler constructs a Handler.
func NewHandler(store *storage.Storage, dispatcher *Dispatcher) *Handler {
	return &Handler{store: store, dispatcher: dispatcher}
}

type ingestRequest struct {
	Source    string                 `json:"source"`
	EventType string                 `json:"event_type"`
	Payload   map[string]interface{} `json:"payload"`
	FireAt    *string                `json:"fire_at"` // optional RFC3339
}

// IngestEvent handles POST /events/ingest.
func (h *Handler) IngestEvent(c *gin.Context) {
	// Auth: extract user from request context (set by authMiddleware.RequireAuth).
	user, ok := auth.GetUserFromContext(c.Request.Context())
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req ingestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON: " + err.Error()})
		return
	}

	// Validate enum fields.
	if !validSources[req.Source] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid source; must be calendar or email"})
		return
	}
	if !validEventTypes[req.EventType] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid event_type; must be calendar_upcoming or email_new"})
		return
	}
	if len(req.Payload) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "payload must not be empty"})
		return
	}

	var fireAt *time.Time
	if req.FireAt != nil && *req.FireAt != "" {
		t, err := time.Parse(time.RFC3339, *req.FireAt)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "fire_at must be RFC3339: " + err.Error()})
			return
		}
		fireAt = &t
	}

	payloadBytes, err := json.Marshal(req.Payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encode payload"})
		return
	}

	ev := &storage.ProactiveEvent{
		ID:        uuid.New(),
		UserID:    user.ID,
		Source:    req.Source,
		EventType: req.EventType,
		Payload:   datatypes.JSON(payloadBytes),
		FireAt:    fireAt,
		State:     "pending",
	}

	created, err := h.store.CreateProactiveEvent(c.Request.Context(), ev)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store event"})
		return
	}

	// For V1: process synchronously if no fire_at or fire_at is in the past.
	now := time.Now()
	if fireAt == nil || fireAt.Before(now) || fireAt.Equal(now) {
		if dispatchErr := h.dispatcher.Dispatch(c.Request.Context(), created); dispatchErr != nil {
			// Log but don't fail the request; the scheduler will retry.
			_ = dispatchErr
		}
		// Reload to return the updated state.
		_ = h.store.DB.WithContext(c.Request.Context()).
			First(created, "id = ?", created.ID)
	}

	c.JSON(http.StatusOK, gin.H{
		"id":    created.ID.String(),
		"state": created.State,
	})
}

type stateRequest struct {
	State string `json:"state"` // "dismissed" | "discussed"
}

// SetEventState handles POST /api/events/:id/state.
func (h *Handler) SetEventState(c *gin.Context) {
	user, ok := auth.GetUserFromContext(c.Request.Context())
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	eventID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid event id"})
		return
	}

	var req stateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.State != "dismissed" && req.State != "discussed" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "state must be dismissed or discussed"})
		return
	}

	ev, err := h.store.GetProactiveEvent(c.Request.Context(), eventID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "event not found"})
		return
	}
	if ev.UserID != user.ID {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	if err := h.store.UpdateEventState(c.Request.Context(), eventID, req.State, ""); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update state"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"state": req.State})
}
