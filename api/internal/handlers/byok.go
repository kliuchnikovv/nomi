package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/internal/crypto"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

// byokProviders is the allowlist of LLM providers a user may bring their own key
// for. Kept in sync with the Python provider→model mapping and the mobile UI.
var byokProviders = map[string]bool{
	"anthropic":  true,
	"google":     true,
	"openrouter": true,
}

// BYOKHandler manages user-supplied LLM provider API keys (bring your own key).
// Keys are encrypted at rest with AES-256-GCM and never returned to the client.
type BYOKHandler struct {
	logger    *zap.Logger
	store     *storage.Storage
	cryptoKey []byte
}

// NewBYOKHandler creates a new BYOK handler. cryptoKey must be the 32-byte
// AES-256 key (decoded from ENCRYPTION_KEY).
func NewBYOKHandler(logger *zap.Logger, store *storage.Storage, cryptoKey []byte) *BYOKHandler {
	return &BYOKHandler{
		logger:    logger.With(zap.String("handler", "byok")),
		store:     store,
		cryptoKey: cryptoKey,
	}
}

// byokProviderInfo describes a configured provider without exposing the key.
type byokProviderInfo struct {
	Provider  string `json:"provider"`
	IsDefault bool   `json:"is_default"`
}

// List returns the providers the user has a BYOK key for (no key values).
// GET /api/byok → { "providers": [{ "provider": "anthropic", "is_default": true }] }
func (h *BYOKHandler) List(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	keys, err := h.store.ListUserAPIKeys(ctx, user.ID)
	if err != nil {
		h.logger.Error("failed to list BYOK keys", zap.String("user_id", user.ID.String()), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list keys"})
		return
	}

	providers := make([]byokProviderInfo, 0, len(keys))
	for _, k := range keys {
		providers = append(providers, byokProviderInfo{Provider: k.Provider, IsDefault: k.IsDefault})
	}
	c.JSON(http.StatusOK, gin.H{"providers": providers})
}

// SaveBYOKRequest is the body for PUT /api/byok/:provider.
type SaveBYOKRequest struct {
	APIKey    string `json:"api_key" binding:"required"`
	IsDefault bool   `json:"is_default,omitempty"`
}

// Save stores (or replaces) the encrypted API key for a provider.
// PUT /api/byok/:provider → { "ok": true }
func (h *BYOKHandler) Save(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	provider := c.Param("provider")
	if !byokProviders[provider] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported provider"})
		return
	}

	var req SaveBYOKRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	encrypted, err := crypto.Encrypt(h.cryptoKey, []byte(req.APIKey))
	if err != nil {
		h.logger.Error("failed to encrypt BYOK key", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store key"})
		return
	}

	if err := h.store.SaveUserAPIKey(ctx, user.ID, provider, encrypted, req.IsDefault); err != nil {
		h.logger.Error("failed to save BYOK key", zap.String("user_id", user.ID.String()), zap.String("provider", provider), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store key"})
		return
	}

	h.logger.Info("BYOK key saved", zap.String("user_id", user.ID.String()), zap.String("provider", provider), zap.Bool("is_default", req.IsDefault))
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// SetDefault marks a provider as the user's default (without changing the key).
// PUT /api/byok/:provider/default → { "ok": true }
func (h *BYOKHandler) SetDefault(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	provider := c.Param("provider")
	if !byokProviders[provider] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported provider"})
		return
	}

	if err := h.store.SetDefaultUserAPIKey(ctx, user.ID, provider); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no key configured for provider"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Delete removes the BYOK key for a provider.
// DELETE /api/byok/:provider → { "ok": true }
func (h *BYOKHandler) Delete(c *gin.Context) {
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

	if err := h.store.DeleteUserAPIKey(ctx, user.ID, provider); err != nil {
		h.logger.Error("failed to delete BYOK key", zap.String("user_id", user.ID.String()), zap.String("provider", provider), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete key"})
		return
	}

	h.logger.Info("BYOK key deleted", zap.String("user_id", user.ID.String()), zap.String("provider", provider))
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
