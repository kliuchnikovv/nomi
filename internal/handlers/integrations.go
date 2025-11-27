package handlers

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/daemon"
	"github.com/kliuchnikovv/genie-api/internal/integrations"
	"github.com/kliuchnikovv/genie-api/internal/llm"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
	"gorm.io/gorm"
)

type IntegrationsHandler struct {
	storage      *storage.Storage
	oauthConfigs map[string]*oauth2.Config
	imapDaemon   *daemon.IMAPDaemon
	logger       *zap.Logger
}

func NewIntegrationsHandler(logger *zap.Logger, storage *storage.Storage, oauthConfigs map[string]*oauth2.Config, imapDaemon *daemon.IMAPDaemon) *IntegrationsHandler {
	return &IntegrationsHandler{
		storage:      storage,
		oauthConfigs: oauthConfigs,
		imapDaemon:   imapDaemon,
		logger:       logger,
	}
}

type integrationRequest struct {
	Name     string `json:"name" binding:"required"`
	Provider string `json:"provider" binding:"required"`
	Params   string `json:"params" binding:"required"`
	Enabled  *bool  `json:"enabled"`
}

type integrationOAuthStatusResponse struct {
	Provider     string   `json:"provider"`
	Authorized   bool     `json:"authorized"`
	AccountEmail string   `json:"account_email,omitempty"`
	Scopes       []string `json:"scopes,omitempty"`
}

// CreateIntegration creates a new integration
func (h *IntegrationsHandler) CreateIntegration(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	var req integrationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	integration := &storage.Integration{
		Name:     req.Name,
		Provider: req.Provider,
		Params:   req.Params,
		Enabled:  enabled,
	}

	created, err := h.storage.CreateIntegration(ctx, user.ID, integration)
	if err != nil {
		h.logger.Error("failed to create integration", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create integration"})
		return
	}

	c.JSON(http.StatusCreated, created)
}

// GetIntegrations returns all integrations for the user
func (h *IntegrationsHandler) GetIntegrations(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	integrations, err := h.storage.GetIntegrations(ctx, user.ID)
	if err != nil {
		h.logger.Error("failed to get integrations", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get integrations"})
		return
	}

	c.JSON(http.StatusOK, integrations)
}

// GetIntegration returns a specific integration
func (h *IntegrationsHandler) GetIntegration(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	integrationID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid integration id"})
		return
	}

	integration, err := h.storage.GetIntegration(ctx, user.ID, integrationID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "integration not found"})
			return
		}
		h.logger.Error("failed to get integration", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get integration"})
		return
	}

	c.JSON(http.StatusOK, integration)
}

// UpdateIntegration updates an integration
func (h *IntegrationsHandler) UpdateIntegration(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	integrationID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid integration id"})
		return
	}

	var req integrationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	integration := &storage.Integration{
		ID:       integrationID,
		Name:     req.Name,
		Provider: req.Provider,
		Params:   req.Params,
		Enabled:  enabled,
	}

	updated, err := h.storage.UpdateIntegration(ctx, user.ID, integration)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "integration not found"})
			return
		}
		h.logger.Error("failed to update integration", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update integration"})
		return
	}

	c.JSON(http.StatusOK, updated)
}

// DeleteIntegration deletes an integration
func (h *IntegrationsHandler) DeleteIntegration(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	integrationID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid integration id"})
		return
	}

	if err := h.storage.DeleteIntegration(ctx, user.ID, integrationID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "integration not found"})
			return
		}
		h.logger.Error("failed to delete integration", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete integration"})
		return
	}

	c.Status(http.StatusNoContent)
}

// SyncIntegration triggers a sync for an integration
func (h *IntegrationsHandler) SyncIntegration(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	integrationID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid integration id"})
		return
	}

	integration, err := h.storage.GetIntegration(ctx, user.ID, integrationID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "integration not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get integration"})
		return
	}

	// TODO: Trigger sync based on provider
	// For now just return OK
	h.logger.Info("sync triggered", zap.String("provider", integration.Provider))

	c.JSON(http.StatusOK, gin.H{"status": "sync_triggered"})
}

type IntegrationInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Provider  string `json:"provider"`
	Connected bool   `json:"connected"`
}

func (h *IntegrationsHandler) ListIntegrations(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	// Get user's integrations to check connection status
	integrationsList, err := h.storage.GetIntegrations(ctx, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	connectedProviders := make(map[string]bool)
	for _, t := range integrationsList {
		connectedProviders[t.Provider] = true
	}

	integrations := []IntegrationInfo{
		{
			ID:       "gmail",
			Name:     "Gmail",
			Provider: "gmail",
		},
		{
			ID:       "calendar",
			Name:     "Google Calendar",
			Provider: "calendar",
		},
	}

	// Update connected status
	for i := range integrations {
		if connectedProviders[integrations[i].Provider] {
			integrations[i].Connected = true
		}
	}

	c.JSON(http.StatusOK, integrations)
}

func (h *IntegrationsHandler) SyncGmail(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	// TODO: Inject dependencies properly instead of creating them here
	// For now, we'll create them on the fly to avoid changing the struct signature too much
	// In a real app, these should be injected in NewIntegrationsHandler
	cfg, err := config.Load("configs/config.yaml") // This is bad practice, but quick for now. Ideally pass cfg to handler.
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load config"})
		return
	}

	llmService, err := llm.NewService(h.logger, cfg, h.storage)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to init llm service: %v", err)})
		return
	}

	service := integrations.NewGmailIMAPService(h.logger, h.storage, llmService)
	if err := service.Sync(ctx, user.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "synced"})
}

func (h *IntegrationsHandler) GetOAuthStatus(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	provider := c.Param("provider")
	if len(provider) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid integration name"})
		return
	}

	status := integrationOAuthStatusResponse{
		Provider: provider,
	}

	token, err := h.storage.GetOAuthTokenByUser(ctx, user.ID, provider)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, status)
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	scopes := make([]string, len(token.Scopes))
	copy(scopes, token.Scopes)
	status.Authorized = true
	status.AccountEmail = token.AccountEmail
	status.Scopes = scopes

	c.JSON(http.StatusOK, status)
}
