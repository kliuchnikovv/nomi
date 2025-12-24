package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

type JulesAuthHandler struct {
	store  *storage.Storage
	logger *zap.Logger
}

func NewJulesAuthHandler(store *storage.Storage, logger *zap.Logger) *JulesAuthHandler {
	return &JulesAuthHandler{
		store:  store,
		logger: logger,
	}
}

func (h *JulesAuthHandler) Connect(c *gin.Context) {
	var req struct {
		ApiKey string `json:"api_key" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "api_key is required"})
		return
	}

	user, ok := auth.GetUserFromContext(c.Request.Context())
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	// Create params JSON
	params := map[string]string{
		"api_key": req.ApiKey,
	}
	paramsBytes, err := json.Marshal(params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to marshal params"})
		return
	}

	// Upsert Logic
	var integration storage.Integration
	result := h.store.DB.Where("user_id = ? AND provider = ?", user.ID, "jules").First(&integration)

	if result.Error != nil {
		// Create new
		integration = storage.Integration{
			ID:        uuid.New(),
			UserID:    user.ID,
			Provider:  "jules",
			Name:      "Jules Agent",
			Enabled:   true,
			Params:    string(paramsBytes),
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		if err := h.store.DB.Create(&integration).Error; err != nil {
			h.logger.Error("failed to create jules integration", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save integration"})
			return
		}
	} else {
		// Update existing
		integration.Params = string(paramsBytes)
		integration.Enabled = true
		integration.UpdatedAt = time.Now()
		if err := h.store.DB.Save(&integration).Error; err != nil {
			h.logger.Error("failed to update jules integration", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update integration"})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"status": "connected", "id": integration.ID})
}
