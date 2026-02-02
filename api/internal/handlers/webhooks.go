package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
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

	// Just acknowledge the webhook - actual processing is done by Python backend
	h.logger.Info("received github webhook", zap.String("event", eventType))
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
