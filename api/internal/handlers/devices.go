package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

type DevicesHandler struct {
	storage *storage.Storage
}

func NewDevicesHandler(store *storage.Storage) *DevicesHandler {
	return &DevicesHandler{storage: store}
}

type registerDeviceRequest struct {
	DeviceToken string `json:"device_token" binding:"required"`
	Platform    string `json:"platform" binding:"required"`
}

func (h *DevicesHandler) Register(c *gin.Context) {
	user, err := userFromCtx(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req registerDeviceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	d := &storage.UserDevice{
		UserID:      user.ID,
		DeviceToken: req.DeviceToken,
		Platform:    req.Platform,
		CreatedAt:   time.Now(),
	}

	if err := h.storage.UpsertDevice(c.Request.Context(), d); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to register device"})
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *DevicesHandler) Deregister(c *gin.Context) {
	user, err := userFromCtx(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	token := c.Param("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing token"})
		return
	}

	if err := h.storage.DeleteDevice(c.Request.Context(), token, user.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to deregister device"})
		return
	}

	c.Status(http.StatusNoContent)
}
