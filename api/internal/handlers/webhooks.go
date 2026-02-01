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
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
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

// GitHub payload structures (minimal)
type GitHubPullRequestEvent struct {
	Action       string             `json:"action"`
	PullRequest  GitHubPullRequest  `json:"pull_request"`
	Repository   GitHubRepository   `json:"repository"`
	Installation GitHubInstallation `json:"installation"`
}

type GitHubPullRequest struct {
	Number  int        `json:"number"`
	Title   string     `json:"title"`
	State   string     `json:"state"`
	Head    GitHubRef  `json:"head"`
	HTMLURL string     `json:"html_url"`
	User    GitHubUser `json:"user"`
}

type GitHubUser struct {
	Login string `json:"login"`
	Type  string `json:"type"` // "User" or "Bot"
}

type GitHubRef struct {
	Ref string `json:"ref"` // branch name
}

type GitHubRepository struct {
	FullName string `json:"full_name"`
}

type GitHubInstallation struct {
	ID int64 `json:"id"`
}

func (h *WebhooksHandler) HandleGitHubWebhook(c *gin.Context) {
	// 1. Validate Payload
	payloadBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read request body"})
		return
	}
	// Restore body for further binding if needed (though we parsed it manually)

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

	if eventType != "pull_request" {
		c.JSON(http.StatusOK, gin.H{"message": "ignored event type"})
		return
	}

	var event GitHubPullRequestEvent
	if err := json.Unmarshal(payloadBody, &event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to parse JSON"})
		return
	}

	// 2. Filter actions
	// We handle "opened", "reopened" (new PR) and "synchronize" (new commits on PR)
	if event.Action != "opened" && event.Action != "reopened" && event.Action != "synchronize" {
		c.JSON(http.StatusOK, gin.H{"message": "ignored action"})
		return
	}

	// 3. Extract Task ID from Branch Name
	// Expected format: feature/TASK-ID-description or similar.
	// We'll search for the UUID or a short ID if we had one. But the system uses UUIDs.
	// Actually, maybe the branch name contains the Short ID?
	// The prompt says: "Jules Worker -> Created GitHub PR".
	// The task ID in the DB is a UUID.
	// I will assume the branch name contains the UUID for now, or I need to handle matching.
	// Let's assume the branch name is `genie-<uuid>` or contains the uuid.

	taskID, err := h.extractTaskID(event.PullRequest.Head.Ref)
	if err != nil {
		h.logger.Warn("could not extract task ID from branch", zap.String("branch", event.PullRequest.Head.Ref))
		c.JSON(http.StatusOK, gin.H{"message": "no task id found in branch"})
		return
	}

	// 4. Update Task Status
	task, err := h.store.GetProjectTask(c.Request.Context(), taskID)
	if err != nil {
		h.logger.Error("task not found", zap.String("task_id", taskID.String()))
		c.JSON(http.StatusOK, gin.H{"message": "task not found"})
		return
	}

	// Only transition if we are in CODING (or earlier?).
	// If event is synchronize, we force update to REVIEW even if already in REVIEW (to re-trigger Reviewer)
	// Or we notify even if status didn't change?
	// The requirement is to trigger Reviewer. The Python side triggers on notification.
	// So we should notify if we are transitioning OR if it's a sync event on existing PR.

	shouldNotify := false
	if task.Status != storage.ProjectTaskStatusReview {
		err := h.store.UpdateProjectTaskStatus(c.Request.Context(), taskID, storage.ProjectTaskStatusReview, nil)
		if err != nil {
			h.logger.Error("failed to update status", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db update failed"})
			return
		}
		shouldNotify = true
	} else if event.Action == "synchronize" {
		// Already in review, but new code pushed -> Re-trigger review
		shouldNotify = true
	}

	if shouldNotify {
		// 5. Notify Python
		// Re-use logic from ProjectTaskHandler or duplicate it.
		// Since we are in a different handler, duplicating the simple notification logic is fine or we can extract it.
		// I will instantiate a ProjectTaskHandler or copy the notify logic. Copying is safer to avoid circular deps if refactoring is hard.
		go h.notifyTeamLead(task.UserID, task.ProjectID, task.ID, task.Status, storage.ProjectTaskStatusReview, event.PullRequest.HTMLURL, event.PullRequest.User.Login)
	}

	c.JSON(http.StatusOK, gin.H{"message": "processed"})
}


// HandleJulesWebhook proxies the incoming Jules webhook to the Python backend
func (h *WebhooksHandler) HandleJulesWebhook(c *gin.Context) {
	// 1. Read Payload
	payloadBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read request body"})
		return
	}

	// 2. Proxy to Python Backend
	url := fmt.Sprintf("%s/webhooks/jules", h.llmBaseURL)
	req, err := http.NewRequest("POST", url, bytes.NewReader(payloadBody))
	if err != nil {
		h.logger.Error("failed to create proxy request", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	// Forward headers if needed (Content-Type)
	req.Header.Set("Content-Type", c.GetHeader("Content-Type"))

	// Use internal secret for auth if needed (although Python endpoint might be public or use labels)
	// But webhooks.py router doesn't seem to enforce auth on /jules unless we add it.
	// The plan didn't specify auth for this webhook, relying on obscure URL or payload validation.
	// However, standard practice is good.
	// We'll pass it just in case future-proofing.
	// req.Header.Set("X-Internal-Secret", h.cfg.InternalSecret) // If available

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		h.logger.Error("failed to forward webhook to python", zap.Error(err))
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to forward webhook"})
		return
	}
	defer resp.Body.Close()

	// 3. Return Python response
	// We can just stream the response back
	for name, values := range resp.Header {
		for _, value := range values {
			c.Writer.Header().Add(name, value)
		}
	}
	c.Status(resp.StatusCode)
	io.Copy(c.Writer, resp.Body)
}

func (h *WebhooksHandler) validateSignature(payload []byte, signatureHeader string) bool {
	// If no secret is configured, skip validation (dev mode)
	// But in prod we must validate.
	// I'll check if config has webhook secret.
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

// Pre-compile regex for performance
var uuidRegex = regexp.MustCompile(`[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}`)

func (h *WebhooksHandler) extractTaskID(branchName string) (uuid.UUID, error) {
	// Simple regex to find a UUID in the string
	// UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
	match := uuidRegex.FindString(branchName)
	if match == "" {
		return uuid.Nil, fmt.Errorf("no uuid found in branch name")
	}
	return uuid.Parse(match)
}

func (h *WebhooksHandler) notifyTeamLead(userID, projectID, taskID uuid.UUID, oldStatus, newStatus storage.ProjectTaskStatus, prURL string, prAuthor string) {
	// Determine source based on PR author
	prSource := "git_agent" // default
	if prAuthor == "google-labs-jules[bot]" || prAuthor == "google-labs-jules" {
		prSource = "jules"
	}

	// Create a payload to match what ProjectTaskHandler sends
	payload := map[string]interface{}{
		"user_id":    userID,
		"project_id": projectID,
		"task_id":    taskID,
		"old_status": oldStatus,
		"new_status": newStatus,
		"pr_url":     prURL,
		"pr_source":  prSource, // "jules" or "git_agent"
		"pr_author":  prAuthor,
		"timestamp":  "now",
		"event":      "pr_opened",
	}

	// We can use the same endpoint /api/notify-lead
	// Using generic map or struct

	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/api/notify-lead", h.llmBaseURL)

	req, _ := http.NewRequest("POST", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	client.Do(req)
}
