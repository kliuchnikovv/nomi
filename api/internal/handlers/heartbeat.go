package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
	"gorm.io/datatypes"
)

// HeartbeatHandler records diagnostic heartbeats from mobile background tasks.
// It exists to confirm that background execution actually runs on-device.
type HeartbeatHandler struct {
	storage *storage.Storage
	logger  *zap.Logger
}

func NewHeartbeatHandler(store *storage.Storage, logger *zap.Logger) *HeartbeatHandler {
	return &HeartbeatHandler{storage: store, logger: logger}
}

type heartbeatRequest struct {
	Source      string         `json:"source"`
	Trigger     string         `json:"trigger"`
	TriggeredAt *time.Time     `json:"triggered_at"`
	Meta        datatypes.JSON `json:"meta"`
}

// Record handles POST /api/heartbeat — persists a heartbeat for the auth'd user.
func (h *HeartbeatHandler) Record(c *gin.Context) {
	user, err := userFromCtx(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req heartbeatRequest
	// Body is optional; ignore bind errors so an empty ping still records.
	_ = c.ShouldBindJSON(&req)

	if req.Source == "" {
		req.Source = "unknown"
	}
	if req.Trigger == "" {
		req.Trigger = "unknown"
	}

	now := time.Now().UTC()
	hb := &storage.Heartbeat{
		UserID:      user.ID,
		Source:      req.Source,
		Trigger:     req.Trigger,
		TriggeredAt: req.TriggeredAt,
		ReceivedAt:  now,
		Meta:        req.Meta,
	}

	if err := h.storage.SaveHeartbeat(c.Request.Context(), hb); err != nil {
		h.logger.Error("failed to save heartbeat", zap.Error(err), zap.String("user_id", user.ID.String()))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save heartbeat"})
		return
	}

	count, _ := h.storage.CountHeartbeats(c.Request.Context(), user.ID)

	h.logger.Info("heartbeat received",
		zap.String("user_id", user.ID.String()),
		zap.String("source", req.Source),
		zap.String("trigger", req.Trigger),
		zap.Int64("total_count", count),
	)

	c.JSON(http.StatusOK, gin.H{
		"status":      "ok",
		"received_at": now.Format(time.RFC3339),
		"total_count": count,
	})
}

// List handles GET /api/heartbeat — returns recent heartbeats for verification.
func (h *HeartbeatHandler) List(c *gin.Context) {
	user, err := userFromCtx(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	heartbeats, err := h.storage.ListHeartbeats(c.Request.Context(), user.ID, 20)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list heartbeats"})
		return
	}

	count, _ := h.storage.CountHeartbeats(c.Request.Context(), user.ID)

	c.JSON(http.StatusOK, gin.H{
		"total_count": count,
		"heartbeats":  heartbeats,
	})
}
