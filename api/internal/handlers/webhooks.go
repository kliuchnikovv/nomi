package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/nomi-api/internal/config"
	"github.com/kliuchnikovv/nomi-api/internal/storage"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

type WebhooksHandler struct {
	store      *storage.Storage
	logger     *zap.Logger
	cfg        *config.Config
	llmBaseURL string
}

func NewWebhooksHandler(store *storage.Storage, logger *zap.Logger, cfg *config.Config) *WebhooksHandler {
	baseURL := cfg.LLM.BaseURL
	if baseURL == "" {
		baseURL = "http://127.0.0.1:7777"
	}
	return &WebhooksHandler{
		store:      store,
		logger:     logger.With(zap.String("component", "webhooks_handler")),
		cfg:        cfg,
		llmBaseURL: baseURL,
	}
}

// HandleGitHubWebhook handles GitHub webhook events
func (h *WebhooksHandler) HandleGitHubWebhook(c *gin.Context) {
	// 1. Validate Payload
	payloadBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read request body"})
		return
	}

	signature := c.GetHeader("X-Hub-Signature-256")
	if !h.validateSignature(payloadBody, signature) {
		h.logger.Warn("invalid webhook signature")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
		return
	}

	eventType := c.GetHeader("X-GitHub-Event")
	if eventType == "ping" {
		c.JSON(http.StatusOK, gin.H{"message": "pong"})
		return
	}

	// When the user removes the app directly from GitHub (Settings → Installed
	// GitHub Apps), GitHub sends an `installation` event. Mirror the removal so we
	// don't keep a stale install row — otherwise ghtoken.ForUser would mint tokens
	// against a dead installation and refuse the OAuth fallback.
	if eventType == "installation" {
		h.handleInstallationEvent(c, payloadBody)
		return
	}

	// Just acknowledge the webhook - actual processing is done by Python backend
	h.logger.Info("received github webhook", zap.String("event", eventType))
	c.JSON(http.StatusOK, gin.H{"message": "acknowledged"})
}

// handleInstallationEvent reacts to GitHub `installation` webhooks. On `deleted`
// (and `suspend`) it removes our local install record and the GitHub Integration
// row so the app shows as disconnected in the UI.
func (h *WebhooksHandler) handleInstallationEvent(c *gin.Context, payload []byte) {
	var evt struct {
		Action       string `json:"action"`
		Installation struct {
			ID int64 `json:"id"`
		} `json:"installation"`
	}
	if err := json.Unmarshal(payload, &evt); err != nil {
		h.logger.Warn("github installation webhook: bad payload", zap.Error(err))
		c.JSON(http.StatusOK, gin.H{"message": "acknowledged"})
		return
	}

	// Only removal-style actions should disconnect the integration.
	if evt.Action != "deleted" && evt.Action != "suspend" {
		c.JSON(http.StatusOK, gin.H{"message": "acknowledged"})
		return
	}

	ctx := c.Request.Context()
	inst, err := h.store.GetGitHubInstallationByInstallationID(ctx, evt.Installation.ID)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			h.logger.Warn("github installation webhook: lookup failed", zap.Error(err),
				zap.Int64("installation_id", evt.Installation.ID))
		}
		c.JSON(http.StatusOK, gin.H{"message": "acknowledged"})
		return
	}

	if err := h.store.DeleteGitHubInstallationByUser(ctx, inst.UserID); err != nil {
		h.logger.Warn("github installation webhook: delete install row failed", zap.Error(err))
	}
	// Disconnect the GitHub Integration row so the UI reflects the removal.
	if err := h.store.DB.WithContext(ctx).
		Where("user_id = ? AND provider = ?", inst.UserID, "github").
		Delete(&storage.Integration{}).Error; err != nil {
		h.logger.Warn("github installation webhook: delete integration failed", zap.Error(err))
	}

	h.logger.Info("github app uninstalled via webhook",
		zap.String("action", evt.Action),
		zap.String("user_id", inst.UserID.String()),
		zap.Int64("installation_id", evt.Installation.ID))
	c.JSON(http.StatusOK, gin.H{"message": "acknowledged"})
}

func (h *WebhooksHandler) validateSignature(payload []byte, signatureHeader string) bool {
	// If no secret is configured, skip validation (dev mode)
	secret := h.cfg.GitHub.WebhookSecret
	if secret == "" {
		h.logger.Warn("no github webhook secret configured, skipping validation")
		return true
	}

	if !strings.HasPrefix(signatureHeader, "sha256=") {
		return false
	}
	signature := strings.TrimPrefix(signatureHeader, "sha256=")

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	expectedMAC := mac.Sum(nil)
	expectedSignature := hex.EncodeToString(expectedMAC)

	return hmac.Equal([]byte(signature), []byte(expectedSignature))
}
