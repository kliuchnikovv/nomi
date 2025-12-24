package jules

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/clients/jules"
	"github.com/kliuchnikovv/genie-api/internal/plugins"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

func NewJulesPlugin() plugins.Plugin {
	return &julesPlugin{}
}

type julesPlugin struct {
	storage plugins.StoragePort
	logger  *zap.Logger
	done    chan struct{}
}

func (j *julesPlugin) Info() plugins.Info {
	return plugins.Info{
		Name:        "jules",
		Description: "Google Jules AI Agent Integration",
		Version:     "0.1.0",
	}
}

func (j *julesPlugin) DefaultState() map[string]interface{} {
	return map[string]interface{}{
		"api_key": "",
	}
}

func (j *julesPlugin) Init(ctx context.Context, rt *plugins.Runtime, state map[string]interface{}) error {
	j.storage = rt.Storage
	j.logger = rt.Logger.With(zap.String("plugin", "jules"))
	j.done = make(chan struct{})

	go j.runSyncLoop()
	return nil
}

func (j *julesPlugin) runSyncLoop() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			ctx := context.Background()
			tools, err := j.storage.GetIntegrationsByProvider(ctx, "jules")
			if err != nil {
				j.logger.Error("failed to get jules tools for auto-sync", zap.Error(err))
				continue
			}
			for _, tool := range tools {
				if err := j.Sync(ctx, tool); err != nil {
					j.logger.Error("sync failed", zap.String("user_id", tool.UserID.String()), zap.Error(err))
				}
			}
		case <-j.done:
			return
		}
	}
}

func (j *julesPlugin) Sync(ctx context.Context, integration storage.Integration) error {
	params, err := parseJulesParams(integration.Params)
	if err != nil {
		return err
	}
	if params.ApiKey == "" {
		return fmt.Errorf("api key missing")
	}

	client := jules.NewClient(params.ApiKey)

	// 1. Sync Sessions -> PluginChats
	sessions, err := client.ListSessions(ctx, 10)
	if err != nil {
		return fmt.Errorf("failed to list sessions: %w", err)
	}

	for _, sess := range sessions {
		// Ensure Chat
		chat, err := j.storage.FindPluginChatByExternalID(ctx, integration.UserID, "jules", sess.Name)
		if err != nil {
			// Create
			chat, err = j.storage.CreatePluginChat(ctx, &storage.PluginChat{
				UserID:        integration.UserID,
				Provider:      "jules",
				IntegrationID: integration.ID,
				ExternalID:    sess.Name, // e.g., "sessions/123"
				Title:         sess.Title,
			})
			if err != nil {
				j.logger.Error("failed to create chat", zap.Error(err))
				continue
			}
		}

		// 2. Sync Activities -> Inbox Items (only Agent messages for now)
		activities, err := client.ListActivities(ctx, sess.Name, 20)
		if err != nil {
			j.logger.Error("failed to list activities", zap.String("session", sess.Name), zap.Error(err))
			continue
		}

		for _, act := range activities {
			// We treat Agent activities as "Incoming Messages"
			if act.Originator != "agent" {
				continue
			}

			// Check if exists
			exists, err := j.storage.InboxExistsByMessageID(ctx, integration.UserID, act.Name)
			if err != nil {
				j.logger.Error("failed to check inbox existence", zap.Error(err))
				continue
			}
			if exists {
				continue
			}

			// Parse content/summary
			content := "Activity: " + act.Name
			if act.ProgressUpdated != nil {
				if title, ok := act.ProgressUpdated["title"].(string); ok {
					content = title
				}
				if desc, ok := act.ProgressUpdated["description"].(string); ok {
					content += "\n" + desc
				}
			} else if act.PlanGenerated != nil {
				content = "Plan Generated"
			}

			// Create Inbox Item
			metadata := map[string]interface{}{
				"session_id": sess.Name,
				"chat_id":    chat.ID.String(),
				"activity":   act,
			}
			metaBytes, _ := json.Marshal(metadata)

			// Parse time
			receivedAt := time.Now()
			if t, err := time.Parse(time.RFC3339, act.CreateTime); err == nil {
				receivedAt = t
			}

			inboxItem := &storage.Inbox{
				UserID:        integration.UserID,
				IntegrationID: integration.ID,
				Source:        "jules",
				MessageID:     act.Name,
				Sender:        "Jules Agent",
				Role:          "daemon",
				Header:        sess.Title, // Group by session title
				Content:       content,
				Status:        "pending",
				Metadata:      metaBytes,
				ReceivedAt:    receivedAt,
			}
			if err := j.storage.CreateInbox(ctx, inboxItem); err != nil {
				j.logger.Error("failed to create inbox item", zap.Error(err))
			}
		}
	}

	return nil
}

func (j *julesPlugin) ExecuteAction(ctx context.Context, userID uuid.UUID, action storage.InboxAction, message storage.Inbox) error {
	// Re-hydrate params to get client
	integrations, err := j.storage.GetIntegrations(ctx, userID)
	if err != nil {
		return err
	}
	var integration *storage.Integration
	for i := range integrations {
		if integrations[i].ID == message.IntegrationID {
			integration = &integrations[i]
			break
		}
	}
	if integration == nil {
		return fmt.Errorf("integration not found")
	}

	_, err = parseJulesParams(integration.Params)
	if err != nil {
		return err
	}

	switch action.Command {
	case "reply":
		// Payload usually has "reply" or "content"
		// Assuming the action.Prompt or external context provided the reply text,
		// but since we lack that here, we assume standard usage via handleSend for text replies.
		// If "reply" means "user clicked reply button", we can't do much without input.
		// If we had a mechanism to get the reply text, we would use:
		// client := jules.NewClient(params.ApiKey)
		// err := client.SendMessage(ctx, sessionID, text)
		return fmt.Errorf("reply action requires text input, use /send endpoint")

	case "mark_as_read":
		// Just update status locally
		message.Status = "processed"
		return j.storage.UpdateInbox(ctx, &message)
	}

	return fmt.Errorf("unknown command: %s", action.Command)
}

func (j *julesPlugin) RegisterRoutes(router *gin.RouterGroup) {
	router.POST("/sync", j.handleSync)
	router.POST("/send", j.handleSend)
}

func (j *julesPlugin) handleSync(c *gin.Context) {
	// Trigger manual sync... similar to gmail
	c.Status(200)
}

func (j *julesPlugin) handleSend(c *gin.Context) {
	var req struct {
		IntegrationID uuid.UUID `json:"integration_id"`
		SessionID     string    `json:"session_id"`
		Message       string    `json:"message"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	// 1. Get Integration to retrieve API Key
	// We need User ID from context (assuming auth middleware)
	// But `plugins` package doesn't depend on `auth` package to avoid cycles?
	// We need to trust the caller or use `c.Get("user")` if standardized.
	// `handleSend` is a gin handler, so we can access context.

	// Assuming "user_id" is injected into context by auth middleware
	// If not, we can't securely get the integration.
	// Let's assume the standard way:
	val, exists := c.Get("user")
	if !exists {
		c.JSON(401, gin.H{"error": "unauthorized"})
		return
	}
	user, ok := val.(*storage.User)
	if !ok {
		c.JSON(500, gin.H{"error": "invalid user context"})
		return
	}

	// 2. Fetch Integrations
	integrations, err := j.storage.GetIntegrations(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(500, gin.H{"error": "failed to get integrations"})
		return
	}

	var integration *storage.Integration
	for i := range integrations {
		if integrations[i].ID == req.IntegrationID {
			integration = &integrations[i]
			break
		}
	}
	if integration == nil {
		c.JSON(404, gin.H{"error": "integration not found"})
		return
	}

	params, err := parseJulesParams(integration.Params)
	if err != nil || params.ApiKey == "" {
		c.JSON(400, gin.H{"error": "invalid integration config"})
		return
	}

	// 3. Send Message
	client := jules.NewClient(params.ApiKey)
	if err := client.SendMessage(c.Request.Context(), req.SessionID, req.Message); err != nil {
		c.JSON(500, gin.H{"error": fmt.Sprintf("failed to send message: %v", err)})
		return
	}

	c.JSON(200, gin.H{"status": "sent"})
}

func (j *julesPlugin) Shutdown(ctx context.Context) error {
	close(j.done)
	return nil
}

type julesParams struct {
	ApiKey string `json:"api_key"`
}

func parseJulesParams(s string) (*julesParams, error) {
	var p julesParams
	if err := json.Unmarshal([]byte(s), &p); err != nil {
		return nil, err
	}
	return &p, nil
}
