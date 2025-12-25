package jules

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/auth"
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
		j.logger.Error("jules sync: failed to list sessions", zap.Error(err))
		return fmt.Errorf("failed to list sessions: %w", err)
	}
	j.logger.Info("jules sync: fetched sessions", zap.Int("count", len(sessions)), zap.String("user_id", integration.UserID.String()))

	if len(sessions) == 0 {
		return nil
	}

	for _, sess := range sessions {
		j.logger.Debug("processing jules session", zap.String("session_name", sess.Name), zap.String("title", sess.Title))
		// Ensure Chat
		chat, err := j.storage.FindPluginChatByExternalID(ctx, integration.UserID, "jules", sess.Name)
		if err != nil {
			// Create
			j.logger.Info("jules: creating new plugin chat",
				zap.String("session", sess.Name),
				zap.String("title", sess.Title),
				zap.String("integration_id", integration.ID.String()))
			
			chat, err = j.storage.CreatePluginChat(ctx, &storage.PluginChat{
				UserID:        integration.UserID,
				Provider:      "jules",
				IntegrationID: integration.ID,
				ExternalID:    sess.Name, // e.g., "sessions/123"
				Title:         sess.Title,
			})
			if err != nil {
				j.logger.Error("jules: FAILED to create plugin chat",
					zap.Error(err),
					zap.String("session", sess.Name))
				continue
			}
			j.logger.Info("jules: created plugin chat", 
				zap.String("chat_id", chat.ID.String()),
				zap.String("integration_id", chat.IntegrationID.String()))
		} else {
			j.logger.Debug("jules: found existing plugin chat", 
				zap.String("chat_id", chat.ID.String()),
				zap.String("integration_id", chat.IntegrationID.String()))
		}

		// 2. Sync Activities -> Inbox Items (only Agent messages for now)
		activities, err := client.ListActivities(ctx, sess.Name, 20)
		if err != nil {
			j.logger.Error("failed to list activities", zap.String("session", sess.Name), zap.Error(err))
			continue
		}

		for _, act := range activities {
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
			} else {
				// Fallback or specific handling for user messages if they have content?
				// Jules activities for 'user' usually are "user said: ..."
				// But we might not have the text in 'activities' response directly in a simple field?
				// API doc says "activities" response has different union fields.
				// Let's assume generic display for now, relying on 'act.Name' or other fields if present.
			}

			// Determine Role
			role := "daemon"
			sender := "Jules Agent"
			if act.Originator == "user" {
				role = "human"
				sender = "Me"
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
				Sender:        sender,
				Role:          role,
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
	router.POST("/connect", j.handleConnect)
}

func (j *julesPlugin) handleConnect(c *gin.Context) {
	var req struct {
		ApiKey string `json:"api_key"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "invalid request body"})
		return
	}

	if req.ApiKey == "" {
		c.JSON(400, gin.H{"error": "api_key is required"})
		return
	}

	user, ok := auth.GetUserFromContext(c.Request.Context())
	if !ok {
		c.JSON(401, gin.H{"error": "unauthorized"})
		return
	}

	// Check for existing integration
	ctx := c.Request.Context()
	existing, err := j.storage.GetIntegrationsByUserProvider(ctx, user.ID, "jules")
	if err != nil {
		j.logger.Error("failed to list integrations", zap.Error(err))
		c.JSON(500, gin.H{"error": "internal error"})
		return
	}

	params := map[string]string{"api_key": req.ApiKey}
	paramsBytes, _ := json.Marshal(params)

	if len(existing) > 0 {
		// Update first existing one
		integration := existing[0]
		integration.Params = string(paramsBytes)
		// We don't have a direct UpdateIntegration method exposed in the interface trivially?
		// Wait, StoragePort has DisableIntegration, but UpdateIntegration?
		// Let's check StoragePort definition in manager.go again.
		// It has: DisableIntegration, CreateInbox, UpdateInbox.
		// It DOES NOT have UpdateIntegration exposed in the interface shown in `view_file` output (lines 20-36 of manager.go).
		// Wait, line 21-36:
		// GetIntegrations...
		// GetOAuthToken...
		// UpdateOAuthToken...
		// DisableIntegration...
		// Inbox...
		// PluginChat...
		// Chat...
		// It seems UpdateIntegration is missing from the interface!
		// BUT `oauth_gmail.go` used `g.storage.UpdateIntegration`.
		// `oauth_gmail.go` uses `*storage.Storage` struct directly, NOT the `StoragePort` interface.
		// `julesPlugin` uses `plugins.StoragePort`.
		
		// I must check if `UpdateIntegration` is in `plugins.StoragePort`.
		// If not, I can't update it easily without casting or adding it.
		// For now, I'll delete and recreate if update is missing, OR better: add it to interface.
		// But I cannot easily change the interface if other plugins rely on it (though usually it's fine).
		
		// ACTUALLY, checking the `manager.go` file again...
		// `type StoragePort interface` at line 20.
		// It does NOT list UpdateIntegration.
		
		// Workaround: Disable old one (soft delete?) and create new one?
		// Or assume the interface implementation (Runtime) has it and I can cast? No, that's bad.
		
		// Let's check if I can just use `CreateIntegration`. Usually Create handles upserts or I can just ignore the old one?
		// No, usually we want one active integration.
		
		// Let's assume for a moment `UpdateIntegration` IS in the interface but I missed it in the truncated view?
		// No, I viewed the whole file.
		
		// Let's use `CreateIntegration`. It might fail if unique constraint?
		// `storage.Integration` likely has no unique constraint on provider/user, multiple allowed?
		// Gmail has one per email.
		
		// I'll try to just Create. If there's an existing one, I'll mark it disabled if I can.
		// Interface has `DisableIntegration(ctx, id)`.
		
		if err := j.storage.DisableIntegration(ctx, integration.ID); err != nil {
			j.logger.Error("failed to disable old integration", zap.Error(err))
		}
	}

	// Create new
	integ := &storage.Integration{
		UserID:   user.ID,
		Provider: "jules",
		Name:     "Jules",
		Params:   string(paramsBytes),
		Enabled:  true,
	}

	if _, err := j.storage.CreateIntegration(ctx, user.ID, integ); err != nil {
		j.logger.Error("failed to create integration", zap.Error(err))
		c.JSON(500, gin.H{"error": "failed to create integration"})
		return
	}

	// Trigger initial sync immediately
	go func() {
		// Use a detached context for async operation
		bgCtx := context.Background()
		if err := j.Sync(bgCtx, *integ); err != nil {
			j.logger.Error("initial sync failed", zap.Error(err))
		}
	}()

	c.JSON(200, gin.H{"status": "connected", "id": integ.ID.String()})
}

func (j *julesPlugin) handleSync(c *gin.Context) {
	// Trigger manual sync for the authenticated user
	user, ok := auth.GetUserFromContext(c.Request.Context())
	if !ok {
		c.JSON(401, gin.H{"error": "unauthorized"})
		return
	}

	// Get Jules integrations for this user
	integrations, err := j.storage.GetIntegrationsByProvider(c.Request.Context(), "jules")
	if err != nil {
		j.logger.Error("failed to get jules integrations", zap.Error(err))
		c.JSON(500, gin.H{"error": "failed to get integrations"})
		return
	}

	var synced int
	var errors []string
	for _, integ := range integrations {
		if integ.UserID != user.ID {
			continue
		}
		j.logger.Info("manual jules sync triggered", zap.String("user_id", user.ID.String()), zap.String("integration_id", integ.ID.String()))
		if err := j.Sync(c.Request.Context(), integ); err != nil {
			j.logger.Error("manual sync failed", zap.Error(err))
			errors = append(errors, err.Error())
		} else {
			synced++
		}
	}

	c.JSON(200, gin.H{
		"status":  "ok",
		"synced":  synced,
		"errors":  errors,
	})
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
	user, ok := auth.GetUserFromContext(c.Request.Context())
	if !ok {
		c.JSON(401, gin.H{"error": "unauthorized"})
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
