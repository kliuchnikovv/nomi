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

// DeleteIntegration removes an integration and its associated plugin data
func (h *IntegrationsHandler) DeleteIntegration(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	idStr := c.Param("id")

	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid integration id"})
		return
	}

	// Look up the integration to get its provider name before deletion
	var integration storage.Integration
	if err := h.store.DB.Where("id = ? AND user_id = ?", id, userID).First(&integration).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "integration not found"})
			return
		}
		h.logger.Error("failed to find integration", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete integration"})
		return
	}

	// Clean up associated plugin_data records
	if err := h.store.DB.Where("user_id = ? AND plugin_name = ?", userID, integration.Provider).
		Delete(&storage.PluginData{}).Error; err != nil {
		h.logger.Warn("failed to clean up plugin data", zap.Error(err), zap.String("provider", integration.Provider))
	}

	// Clean up the stored OAuth/IMAP credential so it doesn't linger after
	// disconnect (and so a reconnect doesn't create a duplicate row).
	if err := h.store.DeleteOAuthTokenByUserAndEmail(
		c.Request.Context(), userID, integration.Provider, integration.AccountEmail,
	); err != nil {
		h.logger.Warn("failed to delete oauth token", zap.Error(err),
			zap.String("provider", integration.Provider),
			zap.String("account_email", integration.AccountEmail))
	}

	// Delete the integration itself
	if err := h.store.DB.Delete(&integration).Error; err != nil {
		h.logger.Error("failed to delete integration", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete integration"})
		return
	}

	c.Status(http.StatusNoContent)
}
