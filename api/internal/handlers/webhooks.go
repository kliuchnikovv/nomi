package handlers

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
	"gorm.io/datatypes"
)

type WebhooksHandler struct {
	store         *storage.Storage
	logger        *zap.Logger
	secret        string
	pythonBaseURL string
}

func NewWebhooksHandler(store *storage.Storage, logger *zap.Logger, secret string, pythonBaseURL string) *WebhooksHandler {
	return &WebhooksHandler{
		store:         store,
		logger:        logger,
		secret:        secret,
		pythonBaseURL: pythonBaseURL,
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

type githubInstallation struct {
	ID int64 `json:"id"`
}

type githubPayload struct {
	Action       string             `json:"action"`
	PullRequest  githubPR           `json:"pull_request"`
	Repository   githubRepo         `json:"repository"`
	Sender       githubUser         `json:"sender"`
	Installation githubInstallation `json:"installation"`
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
		Source:         "github",
		EventType:      eventType,
		Action:         payload.Action,
		RepoFullName:   payload.Repository.FullName,
		PRNumber:       payload.PullRequest.Number,
		PRTitle:        payload.PullRequest.Title,
		PRURL:          payload.PullRequest.HTMLURL,
		DiffURL:        payload.PullRequest.DiffURL,
		Sender:         payload.Sender.Login,
		InstallationID: payload.Installation.ID,
		Status:         "pending",
		Payload:        rawPayload,
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
		zap.Int64("installation_id", payload.Installation.ID),
	)

	// 6. Trigger Python Backend (Development Team)
	go h.triggerReviewAgent(event)

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

func (h *WebhooksHandler) triggerReviewAgent(event *storage.WebhookEvent) {
	if h.pythonBaseURL == "" {
		h.logger.Warn("Python Base URL not configured, skipping review agent trigger")
		return
	}

	url := fmt.Sprintf("%s/api/teams/development/review", h.pythonBaseURL)
	payload := map[string]interface{}{
		"event_id":        event.ID,
		"repo_full_name":  event.RepoFullName,
		"pr_number":       event.PRNumber,
		"installation_id": event.InstallationID,
		"diff_url":        event.DiffURL,
		"action":          event.Action,
	}

	jsonPayload, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonPayload))
	if err != nil {
		h.logger.Error("Failed to create review request", zap.Error(err))
		return
	}
	req.Header.Set("Content-Type", "application/json")
	// TODO: Add internal auth header if needed

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		h.logger.Error("Failed to trigger review agent", zap.Error(err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		h.logger.Error("Review agent returned error", zap.Int("status", resp.StatusCode))
		return
	}

	h.logger.Info("Successfully triggered review agent", zap.String("event_id", event.ID.String()))
}
