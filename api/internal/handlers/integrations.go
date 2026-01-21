package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

type IntegrationsHandler struct {
	store  *storage.Storage
	logger *zap.Logger
}

func NewIntegrationsHandler(store *storage.Storage, logger *zap.Logger) *IntegrationsHandler {
	return &IntegrationsHandler{
		store:  store,
		logger: logger,
	}
}

// ListIntegrations returns all integrations for the user
func (h *IntegrationsHandler) ListIntegrations(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)

	var integrations []storage.Integration
	if err := h.store.DB.Where("user_id = ?", userID).Find(&integrations).Error; err != nil {
		h.logger.Error("failed to list integrations", zap.Error(err), zap.String("user_id", userID.String()))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list integrations"})
		return
	}

	c.JSON(http.StatusOK, integrations)
}

// GetIntegration returns a specific integration
func (h *IntegrationsHandler) GetIntegration(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	idStr := c.Param("id")

	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid integration id"})
		return
	}

	var integration storage.Integration
	if err := h.store.DB.Where("id = ? AND user_id = ?", id, userID).First(&integration).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "integration not found"})
			return
		}
		h.logger.Error("failed to get integration", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	c.JSON(http.StatusOK, integration)
}

// DeleteIntegration removes an integration
func (h *IntegrationsHandler) DeleteIntegration(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	idStr := c.Param("id")

	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid integration id"})
		return
	}

	result := h.store.DB.Where("id = ? AND user_id = ?", id, userID).Delete(&storage.Integration{})
	if result.Error != nil {
		h.logger.Error("failed to delete integration", zap.Error(result.Error))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete integration"})
		return
	}

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "integration not found"})
		return
	}

	c.Status(http.StatusNoContent)
}
