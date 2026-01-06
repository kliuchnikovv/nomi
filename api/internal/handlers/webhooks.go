package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
	"gorm.io/datatypes"
)

type WebhooksHandler struct {
	store  *storage.Storage
	logger *zap.Logger
	secret string
}

func NewWebhooksHandler(store *storage.Storage, logger *zap.Logger, secret string) *WebhooksHandler {
	return &WebhooksHandler{
		store:  store,
		logger: logger,
		secret: secret,
	}
}

// GitHub payload structs
type githubUser struct {
	Login string `json:"login"`
}

type githubRepo struct {
	FullName string `json:"full_name"`
}

type githubPR struct {
	Number  int        `json:"number"`
	Title   string     `json:"title"`
	HTMLURL string     `json:"html_url"`
	DiffURL string     `json:"diff_url"`
	Body    string     `json:"body"`
	User    githubUser `json:"user"`
}

type githubPayload struct {
	Action      string     `json:"action"`
	PullRequest githubPR   `json:"pull_request"`
	Repository  githubRepo `json:"repository"`
	Sender      githubUser `json:"sender"`
}

func (h *WebhooksHandler) HandleGitHub(c *gin.Context) {
	// 1. Validate signature
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		h.logger.Error("Failed to read webhook body", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read body"})
		return
	}

	signature := c.GetHeader("X-Hub-Signature-256")
	if !h.validateSignature(body, signature) {
		h.logger.Warn("Invalid webhook signature", zap.String("signature", signature))
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
		return
	}

	// 2. Parse event and payload
	eventType := c.GetHeader("X-GitHub-Event")
	if eventType != "pull_request" {
		// Just ignore other events
		c.JSON(http.StatusOK, gin.H{"status": "ignored", "reason": "not a pull_request event"})
		return
	}

	var payload githubPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		h.logger.Error("Failed to unmarshal webhook payload", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}

	// 3. Filter by action
	if payload.Action != "opened" && payload.Action != "synchronize" {
		c.JSON(http.StatusOK, gin.H{"status": "ignored", "reason": "action not supported"})
		return
	}

	// 4. Filter by sender (Jules Bot)
	senderLogin := strings.ToLower(payload.Sender.Login)
	if !strings.Contains(senderLogin, "jules") && !strings.Contains(senderLogin, "bot") {
		h.logger.Info("Ignoring PR from non-bot user", zap.String("sender", senderLogin))
		c.JSON(http.StatusOK, gin.H{"status": "ignored", "reason": "sender validation failed"})
		return
	}

	// 5. Save event to DB
	// Store raw payload for debugging
	rawPayload := datatypes.JSON(body)

	event := &storage.WebhookEvent{
		Source:       "github",
		EventType:    eventType,
		Action:       payload.Action,
		RepoFullName: payload.Repository.FullName,
		PRNumber:     payload.PullRequest.Number,
		PRTitle:      payload.PullRequest.Title,
		PRURL:        payload.PullRequest.HTMLURL,
		DiffURL:      payload.PullRequest.DiffURL,
		Sender:       payload.Sender.Login,
		Status:       "pending",
		Payload:      rawPayload,
	}

	if err := h.store.DB.Create(event).Error; err != nil {
		h.logger.Error("Failed to save webhook event", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		return
	}

	h.logger.Info("GitHub webhook: PR received",
		zap.Int("pr_number", payload.PullRequest.Number),
		zap.String("repo", payload.Repository.FullName),
		zap.String("sender", payload.Sender.Login),
	)

	c.JSON(http.StatusOK, gin.H{"status": "ok", "event_id": event.ID})
}

func (h *WebhooksHandler) validateSignature(payload []byte, signatureHeader string) bool {
	if h.secret == "" {
		// If secret is not set, we can't validate, so we fail securely
		h.logger.Error("GITHUB_WEBHOOK_SECRET is not set")
		return false
	}

	if !strings.HasPrefix(signatureHeader, "sha256=") {
		return false
	}

	signature := strings.TrimPrefix(signatureHeader, "sha256=")
	signatureBytes, err := hex.DecodeString(signature)
	if err != nil {
		return false
	}

	mac := hmac.New(sha256.New, []byte(h.secret))
	mac.Write(payload)
	expectedMAC := mac.Sum(nil)

	return hmac.Equal(signatureBytes, expectedMAC)
}
