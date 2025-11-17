package handlers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"gorm.io/gorm"
)

type ToolsHandler struct {
	storage *storage.Storage
}

func NewToolsHandler(storage *storage.Storage) *ToolsHandler {
	return &ToolsHandler{storage: storage}
}

type toolRequest struct {
	Name     string    `json:"name" binding:"required"`
	ConfigID uuid.UUID `json:"config_id"`
	Params   string    `json:"params" binding:"required"`
}

type toolConfigRequest struct {
	Name     string `json:"name" binding:"required"`
	Provider string `json:"provider" binding:"required"`
	Params   string `json:"params" binding:"required"`
}

type toolOAuthStatusResponse struct {
	Provider     string   `json:"provider"`
	Authorized   bool     `json:"authorized"`
	AccountEmail string   `json:"account_email,omitempty"`
	Scopes       []string `json:"scopes,omitempty"`
}

func (h *ToolsHandler) CreateToolConfig(c *gin.Context) {
	ctx := c.Request.Context()
	if _, err := userFromCtx(ctx); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	var payload toolConfigRequest
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	config := &storage.ToolConfig{
		Name:     payload.Name,
		Provider: payload.Provider,
		Params:   payload.Params,
	}

	created, err := h.storage.CreateToolConfig(ctx, config)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, created)
}

func (h *ToolsHandler) ListToolConfigs(c *gin.Context) {
	ctx := c.Request.Context()
	if _, err := userFromCtx(ctx); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	configs, err := h.storage.ListToolConfigs(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, configs)
}

func (h *ToolsHandler) GetToolConfig(c *gin.Context) {
	ctx := c.Request.Context()
	if _, err := userFromCtx(ctx); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	configID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid config UUID"})
		return
	}

	config, err := h.storage.GetToolConfig(ctx, configID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Config not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, config)
}

func (h *ToolsHandler) UpdateToolConfig(c *gin.Context) {
	ctx := c.Request.Context()
	if _, err := userFromCtx(ctx); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	configID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid config UUID"})
		return
	}

	var payload toolConfigRequest
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	config := &storage.ToolConfig{
		ID:       configID,
		Name:     payload.Name,
		Provider: payload.Provider,
		Params:   payload.Params,
	}

	updated, err := h.storage.UpdateToolConfig(ctx, config)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Config not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, updated)
}

func (h *ToolsHandler) DeleteToolConfig(c *gin.Context) {
	ctx := c.Request.Context()
	if _, err := userFromCtx(ctx); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	configID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid config UUID"})
		return
	}

	if err := h.storage.DeleteToolConfig(ctx, configID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Config not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
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
	if payload.ConfigID == uuid.Nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "config_id is required"})
		return
	}

	tool := &storage.Tool{
		ConfigID: payload.ConfigID,
		Name:     payload.Name,
		Params:   payload.Params,
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
	if payload.ConfigID == uuid.Nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "config_id is required"})
		return
	}

	tool := &storage.Tool{
		ID:       toolID,
		ConfigID: payload.ConfigID,
		Name:     payload.Name,
		Params:   payload.Params,
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

func (h *ToolsHandler) GetOAuthStatus(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	toolName := c.Param("tool")
	if len(toolName) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid tool name"})
		return
	}

	config, err := h.storage.GetToolConfigByName(ctx, toolName)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Tool config not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	status := toolOAuthStatusResponse{
		Provider: config.Provider,
	}

	token, err := h.storage.GetOAuthTokenByUser(ctx, user.ID, config.Provider)
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
