package handlers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"golang.org/x/oauth2"
	"gorm.io/gorm"
)

type ToolsHandler struct {
	storage      *storage.Storage
	oauthConfigs map[string]*oauth2.Config
}

func NewToolsHandler(storage *storage.Storage, oauthConfigs map[string]*oauth2.Config) *ToolsHandler {
	return &ToolsHandler{
		storage:      storage,
		oauthConfigs: oauthConfigs,
	}
}

type toolRequest struct {
	Name     string `json:"name" binding:"required"`
	Provider string `json:"provider" binding:"required"`
	Params   string `json:"params" binding:"required"`
	Enabled  *bool  `json:"enabled"`
}

type toolOAuthStatusResponse struct {
	Provider     string   `json:"provider"`
	Authorized   bool     `json:"authorized"`
	AccountEmail string   `json:"account_email,omitempty"`
	Scopes       []string `json:"scopes,omitempty"`
}

func (h *ToolsHandler) CreateTool(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	var payload toolRequest
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	enabled := true
	if payload.Enabled != nil {
		enabled = *payload.Enabled
	}

	tool := &storage.Tool{
		Name:     payload.Name,
		Provider: payload.Provider,
		Params:   payload.Params,
		Enabled:  enabled,
	}

	created, err := h.storage.CreateTool(ctx, user.ID, tool)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, created)
}

func (h *ToolsHandler) ListTools(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	tools, err := h.storage.GetTools(ctx, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, tools)
}

func (h *ToolsHandler) GetTool(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	toolID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid tool UUID"})
		return
	}

	tool, err := h.storage.GetTool(ctx, user.ID, toolID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Tool not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, tool)
}

func (h *ToolsHandler) UpdateTool(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	toolID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid tool UUID"})
		return
	}

	var payload toolRequest
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	enabled := true
	if payload.Enabled != nil {
		enabled = *payload.Enabled
	}

	tool := &storage.Tool{
		ID:       toolID,
		Name:     payload.Name,
		Provider: payload.Provider,
		Params:   payload.Params,
		Enabled:  enabled,
	}

	updated, err := h.storage.UpdateTool(ctx, user.ID, tool)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Tool not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, updated)
}

func (h *ToolsHandler) DeleteTool(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	toolID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid tool UUID"})
		return
	}

	if err := h.storage.DeleteTool(ctx, user.ID, toolID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Tool not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}

type IntegrationInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Provider  string `json:"provider"`
	Connected bool   `json:"connected"`
}

func (h *ToolsHandler) ListIntegrations(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	// Get user's tools to check connection status
	tools, err := h.storage.GetTools(ctx, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	connectedProviders := make(map[string]bool)
	for _, t := range tools {
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

func (h *ToolsHandler) GetOAuthStatus(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	provider := c.Param("provider")
	if len(provider) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid tool name"})
		return
	}

	status := toolOAuthStatusResponse{
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
