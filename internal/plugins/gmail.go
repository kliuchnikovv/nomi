package plugins

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/emersion/go-imap/client"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

// NewGmailPlugin returns a Gmail-specific IMAP plugin implementation.
func NewGmailPlugin() Plugin {
	return NewIMAPPlugin(&gmailBackend{})
}

type gmailBackend struct {
	syncer  *EmailSyncer
	storage *storage.Storage
	logger  *zap.Logger
	done    chan struct{}
}

func (g *gmailBackend) Info() Info {
	return Info{
		Name:        "gmail",
		Description: "Gmail integration plugin built on IMAP",
		Version:     "0.2.0",
	}
}

func (g *gmailBackend) DefaultState() map[string]interface{} {
	return map[string]interface{}{
		"permissions": []string{"gmail:read"},
		"imap_host":   "imap.gmail.com",
		"imap_port":   993,
	}
}

func (g *gmailBackend) Init(ctx context.Context, rt *Runtime, state map[string]interface{}) error {
	g.storage = rt.Storage
	g.logger = rt.Logger.With(zap.String("plugin", "gmail"))
	g.syncer = NewEmailSyncer(rt.Logger, rt.Storage, rt.LLMService, "gmail")
	g.done = make(chan struct{})

	// Start auto-sync loop
	go g.runSyncLoop()

	return nil
}

func (g *gmailBackend) runSyncLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			ctx := context.Background()
			tools, err := g.storage.GetToolsByProvider(ctx, "gmail")
			if err != nil {
				g.logger.Error("failed to get gmail tools for auto-sync", zap.Error(err))
				continue
			}

			g.logger.Info("auto-sync triggered", zap.Int("users_count", len(tools)))

			for _, tool := range tools {
				g.logger.Info("syncing user", zap.String("user_id", tool.UserID.String()))
				if err := g.Sync(ctx, tool.UserID); err != nil {
					g.logger.Error("auto-sync failed for user",
						zap.String("user_id", tool.UserID.String()),
						zap.Error(err))
				}
			}
		case <-g.done:
			return
		}
	}
}

func (g *gmailBackend) RegisterRoutes(router *gin.RouterGroup) {
	router.POST("/sync", g.syncHandler)
}

func (g *gmailBackend) syncHandler(c *gin.Context) {
	// Helper to get user from context (assuming auth middleware)
	// We need to access the user ID from the context safely
	// Since we don't have the helper function here, we'll assume it's set in context
	// by AuthMiddleware and accessible.
	// In server.go we use userFromCtx but it's private in handlers package.
	// We'll rely on a common way or just use the one from context if available.
	// For now, let's assume "user_id" is in context as uuid.UUID or string.

	// Actually, we can't easily get user ID without the helper.
	// But we can look at how handlers do it. They use `userFromCtx`.
	// Since we are in `plugins` package, we don't have access to `handlers.userFromCtx`.
	// We should probably pass the user ID extraction logic or make it public.
	// For now, let's try to get it from "user" key which is standard in our AuthMiddleware.

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

	if err := g.Sync(c.Request.Context(), user.ID); err != nil {
		g.logger.Error("sync failed", zap.Error(err))
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{"message": "sync completed"})
}

func (g *gmailBackend) Sync(ctx context.Context, userID uuid.UUID) error {
	// 1. Get Gmail tool params
	tools, err := g.storage.GetTools(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to get tools: %w", err)
	}

	var gmailTool *storage.Tool
	for _, t := range tools {
		if t.Provider == "gmail" && t.Enabled {
			gmailTool = &t
			break
		}
	}

	if gmailTool == nil {
		return fmt.Errorf("gmail integration not found or disabled")
	}

	var params struct {
		Creds struct {
			Token string `json:"token"`
		} `json:"creds"`
	}
	if err := json.Unmarshal([]byte(gmailTool.Params), &params); err != nil {
		return fmt.Errorf("failed to parse gmail params: %w", err)
	}

	if params.Creds.Token == "" {
		return fmt.Errorf("gmail access token not found")
	}

	// 2. Connect to IMAP
	c, err := client.DialTLS("imap.gmail.com:993", nil)
	if err != nil {
		return fmt.Errorf("failed to dial imap: %w", err)
	}
	defer c.Logout()

	// Authenticate using XOAUTH2
	oauthToken, err := g.storage.GetOAuthTokenByUser(ctx, userID, "gmail")
	if err != nil {
		return fmt.Errorf("failed to get oauth token info: %w", err)
	}

	saslClient := &Xoauth2Client{
		Username: oauthToken.AccountEmail,
		Token:    params.Creds.Token,
	}

	if err := c.Authenticate(saslClient); err != nil {
		return fmt.Errorf("imap authentication failed: %w", err)
	}

	// 3. Delegate to Syncer
	return g.syncer.Sync(ctx, userID, c)
}

func (g *gmailBackend) ExecuteAction(ctx context.Context, userID uuid.UUID, action storage.InboxAction, message storage.Inbox) error {
	// 1. Get Gmail tool params (reuse logic from Sync)
	// TODO: Refactor credential fetching into a helper method to avoid duplication
	tools, err := g.storage.GetTools(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to get tools: %w", err)
	}

	var gmailTool *storage.Tool
	for _, t := range tools {
		if t.Provider == "gmail" && t.Enabled {
			gmailTool = &t
			break
		}
	}

	if gmailTool == nil {
		return fmt.Errorf("gmail integration not found or disabled")
	}

	var params struct {
		Creds struct {
			Token string `json:"token"`
		} `json:"creds"`
	}
	if err := json.Unmarshal([]byte(gmailTool.Params), &params); err != nil {
		return fmt.Errorf("failed to parse gmail params: %w", err)
	}

	if params.Creds.Token == "" {
		return fmt.Errorf("gmail access token not found")
	}

	// 2. Connect to IMAP
	c, err := client.DialTLS("imap.gmail.com:993", nil)
	if err != nil {
		return fmt.Errorf("failed to dial imap: %w", err)
	}
	defer c.Logout()

	// Authenticate using XOAUTH2
	oauthToken, err := g.storage.GetOAuthTokenByUser(ctx, userID, "gmail")
	if err != nil {
		return fmt.Errorf("failed to get oauth token info: %w", err)
	}

	saslClient := &Xoauth2Client{
		Username: oauthToken.AccountEmail,
		Token:    params.Creds.Token,
	}

	if err := c.Authenticate(saslClient); err != nil {
		return fmt.Errorf("imap authentication failed: %w", err)
	}

	// 3. Select Inbox (needed for operations)
	if _, err := c.Select("INBOX", false); err != nil {
		return fmt.Errorf("failed to select inbox: %w", err)
	}

	// 4. Execute Action
	switch action.Command {
	case "mark_as_read":
		return g.syncer.MarkAsRead(ctx, userID, []uint32{message.UID}, c)
	case "archive":
		return g.syncer.Archive(ctx, userID, []uint32{message.UID}, c)
	default:
		return fmt.Errorf("unsupported action: %s", action.Command)
	}
}

func (g *gmailBackend) Status(ctx context.Context, state map[string]interface{}) (map[string]interface{}, error) {
	return map[string]interface{}{
		"provider":  "gmail",
		"connected": true, // Simplified
	}, nil
}

func (g *gmailBackend) Shutdown(ctx context.Context) error {
	close(g.done)
	return nil
}
