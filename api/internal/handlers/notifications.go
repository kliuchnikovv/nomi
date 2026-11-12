package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/nomi-api/internal/storage"
	"gorm.io/datatypes"
)

type NotificationsHandler struct {
	storage *storage.Storage
}

func NewNotificationsHandler(store *storage.Storage) *NotificationsHandler {
	return &NotificationsHandler{storage: store}
}

type createNotificationRequest struct {
	Type        string                 `json:"type" binding:"required"`
	Title       string                 `json:"title" binding:"required"`
	Body        string                 `json:"body" binding:"required"`
	ScheduledAt time.Time              `json:"scheduled_at" binding:"required"`
	DeepLink    map[string]interface{} `json:"deep_link"`
	Metadata    map[string]interface{} `json:"metadata"`
}

func (h *NotificationsHandler) Create(c *gin.Context) {
	user, err := userFromCtx(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req createNotificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	n := &storage.Notification{
		UserID:      user.ID,
		Type:        req.Type,
		Title:       req.Title,
		Body:        req.Body,
		ScheduledAt: req.ScheduledAt,
	}
	if req.DeepLink != nil {
		if b, err := json.Marshal(req.DeepLink); err == nil {
			n.DeepLink = datatypes.JSON(b)
		}
	}
	if req.Metadata != nil {
		if b, err := json.Marshal(req.Metadata); err == nil {
			n.Metadata = datatypes.JSON(b)
		}
	}

	if err := h.storage.CreateNotification(c.Request.Context(), n); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create notification"})
		return
	}

	c.JSON(http.StatusCreated, n)
}

func (h *NotificationsHandler) List(c *gin.Context) {
	user, err := userFromCtx(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	notifications, err := h.storage.ListNotificationsForUser(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list notifications"})
		return
	}

	c.JSON(http.StatusOK, notifications)
}

func (h *NotificationsHandler) Cancel(c *gin.Context) {
	user, err := userFromCtx(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	if err := h.storage.CancelNotification(c.Request.Context(), id, user.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to cancel notification"})
		return
	}

	c.Status(http.StatusNoContent)
}
