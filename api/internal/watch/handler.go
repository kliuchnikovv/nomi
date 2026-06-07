// Package watch exposes the HTTP endpoints for agent-set self-reminders
// ("watch reminders"). The Python brain calls these on the user's behalf; the
// scheduler later converts due reminders into proactive "watch_reminder" events.
package watch

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// Handler exposes the watch-reminder HTTP endpoints.
type Handler struct {
	store *storage.Storage
}

// NewHandler constructs a Handler.
func NewHandler(store *storage.Storage) *Handler {
	return &Handler{store: store}
}

type createRequest struct {
	Context string `json:"context"`
	FireAt  string `json:"fire_at"` // RFC3339
}

// Create handles POST /api/watches.
func (h *Handler) Create(c *gin.Context) {
	user, ok := auth.GetUserFromContext(c.Request.Context())
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req createRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON: " + err.Error()})
		return
	}
	if req.Context == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "context must not be empty"})
		return
	}
	fireAt, err := time.Parse(time.RFC3339, req.FireAt)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "fire_at must be RFC3339: " + err.Error()})
		return
	}
	if !fireAt.After(time.Now()) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "fire_at must be in the future"})
		return
	}

	w, err := h.store.CreateWatchReminder(c.Request.Context(), &storage.WatchReminder{
		UserID:  user.ID,
		Context: req.Context,
		FireAt:  fireAt.UTC(),
		State:   "pending",
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store watch reminder"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":      w.ID.String(),
		"fire_at": w.FireAt.Format(time.RFC3339),
	})
}

// List handles GET /api/watches — returns the user's pending watch reminders.
func (h *Handler) List(c *gin.Context) {
	user, ok := auth.GetUserFromContext(c.Request.Context())
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	rows, err := h.store.ListWatchReminders(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list watch reminders"})
		return
	}

	out := make([]gin.H, 0, len(rows))
	for _, w := range rows {
		out = append(out, gin.H{
			"id":      w.ID.String(),
			"context": w.Context,
			"fire_at": w.FireAt.Format(time.RFC3339),
		})
	}
	c.JSON(http.StatusOK, gin.H{"watches": out})
}

// Cancel handles DELETE /api/watches/:id.
func (h *Handler) Cancel(c *gin.Context) {
	user, ok := auth.GetUserFromContext(c.Request.Context())
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid watch id"})
		return
	}

	if err := h.store.CancelWatchReminder(c.Request.Context(), user.ID, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to cancel watch reminder"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
