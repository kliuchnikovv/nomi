package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/internal/credentials"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

// CredentialsHandler handles API key and custom credential storage
type CredentialsHandler struct {
	logger    *zap.Logger
	credStore credentials.Store
}

// NewCredentialsHandler creates a new credentials handler
func NewCredentialsHandler(logger *zap.Logger, credStore credentials.Store) *CredentialsHandler {
	return &CredentialsHandler{
		logger:    logger.With(zap.String("handler", "credentials")),
		credStore: credStore,
	}
}

// SaveCredentialsRequest is the request to save API key credentials
// POST /api/credentials
// Request: SaveCredentialsRequest
// Response: { "ok": true }
type SaveCredentialsRequest struct {
	Provider string                 `json:"provider" binding:"required"`
	Type     string                 `json:"type" binding:"required,oneof=api_key custom"`
	APIKey   string                 `json:"api_key,omitempty"`
	Extra    map[string]interface{} `json:"extra,omitempty"`
}

// Save saves API key or custom credentials to Redis
func (h *CredentialsHandler) Save(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req SaveCredentialsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var data *credentials.CredentialData
	switch req.Type {
	case "api_key":
		if req.APIKey == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "api_key is required for type=api_key"})
			return
		}
		data = &credentials.CredentialData{
			Type:   credentials.CredentialTypeAPIKey,
			APIKey: req.APIKey,
			Extra:  req.Extra,
		}
	case "custom":
		data = &credentials.CredentialData{
			Type:  credentials.CredentialTypeCustom,
			Extra: req.Extra,
		}
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid credential type"})
		return
	}

	if err := h.credStore.Save(ctx, user.ID, req.Provider, data, 0); err != nil {
		h.logger.Error("failed to save credentials",
			zap.String("user_id", user.ID.String()),
			zap.String("provider", req.Provider),
			zap.Error(err),
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save credentials"})
		return
	}

	h.logger.Info("credentials saved",
		zap.String("user_id", user.ID.String()),
		zap.String("provider", req.Provider),
		zap.String("type", req.Type),
	)

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// CheckResponse is the response for credential existence check
// GET /api/credentials/:provider/check
// Response: { "exists": true }
type CheckResponse struct {
	Exists bool `json:"exists"`
}

// Check checks if credentials exist for a provider (without extending TTL)
func (h *CredentialsHandler) Check(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	provider := c.Param("provider")
	if provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider is required"})
		return
	}

	exists, err := h.credStore.Exists(ctx, user.ID, provider)
	if err != nil {
		h.logger.Error("failed to check credentials",
			zap.String("user_id", user.ID.String()),
			zap.String("provider", provider),
			zap.Error(err),
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check credentials"})
		return
	}

	c.JSON(http.StatusOK, CheckResponse{Exists: exists})
}

// Delete removes credentials for a provider
// DELETE /api/credentials/:provider
// Response: { "ok": true }
func (h *CredentialsHandler) Delete(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	provider := c.Param("provider")
	if provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider is required"})
		return
	}

	if err := h.credStore.Delete(ctx, user.ID, provider); err != nil {
		h.logger.Error("failed to delete credentials",
			zap.String("user_id", user.ID.String()),
			zap.String("provider", provider),
			zap.Error(err),
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete credentials"})
		return
	}

	h.logger.Info("credentials deleted",
		zap.String("user_id", user.ID.String()),
		zap.String("provider", provider),
	)

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ListResponse lists all providers with stored credentials
// GET /api/credentials
// Response: { "providers": ["jules", "github"] }
type ListResponse struct {
	Providers []string `json:"providers"`
}

// List returns all providers with stored credentials for the user
func (h *CredentialsHandler) List(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	providers, err := h.credStore.ListProviders(ctx, user.ID)
	if err != nil {
		h.logger.Error("failed to list credentials",
			zap.String("user_id", user.ID.String()),
			zap.Error(err),
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list credentials"})
		return
	}

	c.JSON(http.StatusOK, ListResponse{Providers: providers})
}

// RequestCredentialsRequest is sent by client when server needs credentials
// POST /api/credentials/request
// Request: RequestCredentialsRequest
// Response: { "ok": true }
type RequestCredentialsRequest struct {
	Providers []string `json:"providers" binding:"required"`
}

// Request handles client-side notification about missing credentials
// The client will then send the credentials via WebSocket or make a separate POST /api/credentials
func (h *CredentialsHandler) Request(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req RequestCredentialsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check which credentials are actually missing
	missingProviders := []string{}
	for _, provider := range req.Providers {
		exists, err := h.credStore.Exists(ctx, user.ID, provider)
		if err != nil {
			h.logger.Warn("failed to check credentials",
				zap.String("user_id", user.ID.String()),
				zap.String("provider", provider),
				zap.Error(err),
			)
			continue
		}
		if !exists {
			missingProviders = append(missingProviders, provider)
		}
	}

	if len(missingProviders) > 0 {
		// Return which providers are missing so client can prompt user
		c.JSON(http.StatusOK, gin.H{
			"ok":             true,
			"missing":        missingProviders,
			"requires_input": true,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "requires_input": false})
}

// enrichCommandWithRedisCredentials adds credentials from Redis to the command
func (h *CredentialsHandler) enrichCommandWithRedisCredentials(user *storage.User, command string) string {
	// This will be used by stream.go to add credentials to the command sent to Python
	// Implementation will be added when we update stream.go
	return command
}
