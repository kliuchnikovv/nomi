package handlers

import (
	"encoding/json"
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
	Name     string    `json:"name" binding:"required"`
	ConfigID uuid.UUID `json:"config_id"`
	Params   string    `json:"params" binding:"required"`
	Enabled  *bool     `json:"enabled"`
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

// enrichParamsWithOAuthTokens получает OAuth токены и добавляет их в params инструмента
func (h *ToolsHandler) enrichParamsWithOAuthTokens(ctx *gin.Context, userID uuid.UUID, configID uuid.UUID, paramsJSON string) (string, error) {
	// Получаем ToolConfig чтобы узнать provider
	config, err := h.storage.GetToolConfig(ctx.Request.Context(), configID)
	if err != nil {
		return paramsJSON, err
	}

	// Получаем OAuth токен для provider
	oauthToken, err := h.storage.GetOAuthTokenByUser(ctx.Request.Context(), userID, config.Provider)
	if err != nil {
		// Если токен не найден, возвращаем params без изменений
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return paramsJSON, nil
		}
		return paramsJSON, err
	}

	// Декодируем OAuth токен из JSON байтов
	var token oauth2.Token
	if err := json.Unmarshal(oauthToken.TokenEncrypted, &token); err != nil {
		return paramsJSON, err
	}

	// Парсим существующие params
	var params map[string]any
	if paramsJSON == "" {
		params = make(map[string]any)
	} else {
		if err := json.Unmarshal([]byte(paramsJSON), &params); err != nil {
			// Если не удалось распарсить, создаем новый объект
			params = make(map[string]any)
		}
	}

	// Добавляем токены в params
	params["access_token"] = token.AccessToken
	if token.RefreshToken != "" {
		params["refresh_token"] = token.RefreshToken
	}

	// Добавляем OAuth конфигурацию провайдера
	if oauthCfg, ok := h.oauthConfigs[config.Provider]; ok && oauthCfg != nil {
		if oauthCfg.Endpoint.TokenURL != "" {
			params["token_uri"] = oauthCfg.Endpoint.TokenURL
		}
		if oauthCfg.ClientID != "" {
			params["client_id"] = oauthCfg.ClientID
		}
		if oauthCfg.ClientSecret != "" {
			params["client_secret"] = oauthCfg.ClientSecret
		}
	}

	// Сериализуем обратно в JSON
	enrichedParamsJSON, err := json.Marshal(params)
	if err != nil {
		return paramsJSON, err
	}

	return string(enrichedParamsJSON), nil
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

	tools, err := h.storage.GetTools(ctx, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	for _, tool := range tools {
		if tool.Name == payload.Name || tool.ConfigID == payload.ConfigID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "tool already created"})
			return
		}
	}

	enabled := true
	if payload.Enabled != nil {
		enabled = *payload.Enabled
	}

	// Обогащаем params OAuth токенами
	enrichedParams, err := h.enrichParamsWithOAuthTokens(c, user.ID, payload.ConfigID, payload.Params)
	if err != nil {
		// Логируем ошибку, но продолжаем создание с исходными params
		// Это позволит создать tool даже если OAuth токен еще не получен
		enrichedParams = payload.Params
	}

	tool := &storage.Tool{
		ConfigID: payload.ConfigID,
		Name:     payload.Name,
		Params:   enrichedParams,
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
	if payload.ConfigID == uuid.Nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "config_id is required"})
		return
	}

	enabled := true
	if payload.Enabled != nil {
		enabled = *payload.Enabled
	}

	// Обогащаем params OAuth токенами
	enrichedParams, err := h.enrichParamsWithOAuthTokens(c, user.ID, payload.ConfigID, payload.Params)
	if err != nil {
		// Логируем ошибку, но продолжаем обновление с исходными params
		// Это позволит обновить tool даже если OAuth токен не найден
		enrichedParams = payload.Params
	}

	tool := &storage.Tool{
		ID:       toolID,
		ConfigID: payload.ConfigID,
		Name:     payload.Name,
		Params:   enrichedParams,
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
