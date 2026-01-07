package handlers

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

type WebhooksHandler struct {
	Store  *storage.Storage
	Logger *zap.Logger
	Config *config.Config
}

func NewWebhooksHandler(store *storage.Storage, logger *zap.Logger, cfg *config.Config) *WebhooksHandler {
	return &WebhooksHandler{
		Store:  store,
		Logger: logger,
		Config: cfg,
	}
}

// GitHubWebhookPayload represents a minimal payload structure for Pull Request events
type GitHubWebhookPayload struct {
	Action      string `json:"action"`
	Number      int    `json:"number"`
	PullRequest struct {
		Number int `json:"number"`
		Head   struct {
			Ref string `json:"ref"`
			Sha string `json:"sha"`
		} `json:"head"`
		Base struct {
			Ref string `json:"ref"`
		} `json:"base"`
		Title string `json:"title"`
	} `json:"pull_request"`
	Repository struct {
		FullName string `json:"full_name"`
	} `json:"repository"`
	Installation struct {
		ID int64 `json:"id"`
	} `json:"installation"`
}

// HandleGithubWebhook processes incoming GitHub webhooks
func (h *WebhooksHandler) HandleGithubWebhook(c *gin.Context) {
	// 1. Verify Signature
	payloadBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		h.Logger.Error("Failed to read webhook body", zap.Error(err))
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	defer c.Request.Body.Close()

	secret := os.Getenv("GITHUB_WEBHOOK_SECRET")
	if secret != "" {
		signature := c.GetHeader("X-Hub-Signature-256")
		if !h.validateSignature(payloadBody, signature, secret) {
			h.Logger.Warn("Invalid webhook signature")
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
	}

	// 2. Parse Event
	eventType := c.GetHeader("X-GitHub-Event")
	if eventType != "pull_request" {
		// We only care about PRs for now
		c.Status(http.StatusOK)
		return
	}

	var payload GitHubWebhookPayload
	if err := json.Unmarshal(payloadBody, &payload); err != nil {
		h.Logger.Error("Failed to parse webhook json", zap.Error(err))
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	// Filter actions: opened, synchronize (updates), reopened
	if payload.Action != "opened" && payload.Action != "synchronize" && payload.Action != "reopened" {
		c.Status(http.StatusOK)
		return
	}

	// 3. Forward to Python Brain
	go h.forwardToPython(payload)

	c.JSON(http.StatusOK, gin.H{"status": "accepted"})
}

func (h *WebhooksHandler) validateSignature(payload []byte, signatureHeader string, secret string) bool {
	if !strings.HasPrefix(signatureHeader, "sha256=") {
		return false
	}
	signature := signatureHeader[7:] // Remove "sha256=" prefix

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	expectedMAC := mac.Sum(nil)
	expectedSignature := hex.EncodeToString(expectedMAC)

	return hmac.Equal([]byte(signature), []byte(expectedSignature))
}

func (h *WebhooksHandler) forwardToPython(payload GitHubWebhookPayload) {
	// Construct payload for Python
	// We map it to what webhooks.py expects
	pythonPayload := map[string]interface{}{
		"action":          payload.Action,
		"pr_number":       payload.Number,
		"repository":      payload.Repository.FullName,
		"branch":          payload.PullRequest.Head.Ref,
		"diff":            "", // We don't fetch diff here, Python/Agent will do it or we assume empty for now
		"installation_id": payload.Installation.ID,
	}

	jsonData, err := json.Marshal(pythonPayload)
	if err != nil {
		h.Logger.Error("Failed to marshal python payload", zap.Error(err))
		return
	}

	// Python Service URL
	url := h.Config.LLM.BaseURL + "/webhooks/github"
	if h.Config.LLM.BaseURL == "" {
		url = "http://127.0.0.1:7777/webhooks/github"
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		h.Logger.Error("Failed to create request to python", zap.Error(err))
		return
	}

	req.Header.Set("Content-Type", "application/json")
	// Add Internal Secret
	internalKey := os.Getenv("INTERNAL_API_KEY")
	if internalKey == "" {
		internalKey = "jules-secret-key"
	}
	req.Header.Set("X-Internal-Secret", internalKey)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		h.Logger.Error("Failed to forward to python", zap.Error(err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		h.Logger.Error("Python webhook endpoint returned error", zap.Int("status", resp.StatusCode))
	} else {
		h.Logger.Info("Successfully forwarded webhook to python", zap.String("repo", payload.Repository.FullName), zap.Int("pr", payload.Number))
	}
}
