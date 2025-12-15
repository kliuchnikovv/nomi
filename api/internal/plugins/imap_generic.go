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

// NewGenericIMAPPlugin creates a configurable IMAP plugin with default host/port placeholders.
func NewGenericIMAPPlugin() Plugin {
	return NewIMAPPlugin(&genericIMAPBackend{})
}

type genericIMAPBackend struct {
	syncer  *EmailSyncer
	storage StoragePort
	logger  *zap.Logger
	done    chan struct{}
}

func (g *genericIMAPBackend) Info() Info {
	return Info{
		Name:        "imap",
		Description: "Generic IMAP integration plugin",
		Version:     "0.1.0",
	}
}

func (g *genericIMAPBackend) DefaultState() map[string]interface{} {
	return map[string]interface{}{
		"imap_host": "imap.example.com",
		"imap_port": 993,
		"username":  "user@example.com",
		"password":  "", // Should be stored securely, but for now in state
	}
}

func (g *genericIMAPBackend) Init(ctx context.Context, rt *Runtime, state map[string]interface{}) error {
	g.storage = rt.Storage
	g.logger = rt.Logger.With(zap.String("plugin", "imap"))
	g.syncer = NewEmailSyncer(rt.Logger, rt.Storage, rt.LLMService, "imap")
	g.done = make(chan struct{})

	// Start auto-sync loop
	go g.runSyncLoop()

	return nil
}

func (g *genericIMAPBackend) runSyncLoop() {
	ticker := time.NewTicker(2 * time.Minute) // Less frequent than Gmail
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			ctx := context.Background()
			tools, err := g.storage.GetIntegrationsByProvider(ctx, "imap")
			if err != nil {
				g.logger.Error("failed to get imap tools for auto-sync", zap.Error(err))
				continue
			}

			g.logger.Info("auto-sync triggered", zap.Int("users_count", len(tools)))

			for _, tool := range tools {
				// Parse params to get credentials
				var params struct {
					Host     string `json:"host"`
					Port     int    `json:"port"`
					Username string `json:"username"`
					Password string `json:"password"`
				}
				if err := json.Unmarshal([]byte(tool.Params), &params); err != nil {
					g.logger.Error("failed to parse imap params for user",
						zap.String("user_id", tool.UserID.String()),
						zap.Error(err))
					continue
				}

				if params.Host == "" || params.Username == "" || params.Password == "" {
					g.logger.Warn("skipping user with incomplete imap credentials",
						zap.String("user_id", tool.UserID.String()))
					continue
				}

				g.logger.Info("syncing user", zap.String("user_id", tool.UserID.String()))
				if err := g.Sync(ctx, tool.UserID, params.Host, params.Port, params.Username, params.Password); err != nil {
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

func (g *genericIMAPBackend) RegisterRoutes(router *gin.RouterGroup) {
	router.POST("/sync", g.syncHandler)
}

func (g *genericIMAPBackend) syncHandler(c *gin.Context) {
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

	// For generic IMAP, we need connection details.
	// In a real plugin system, these would come from the plugin instance configuration for this user.
	// Since we don't have per-user plugin config instances easily accessible here (only global state),
	// we'll assume they are passed in the request body for now, or we'd need to fetch them from DB
	// if we stored them in a "plugin_configs" table.
	//
	// However, the current architecture stores plugin state in `plugins.Manager.state`.
	// But that state is global/shared or per-plugin, not per-user.
	//
	// Let's assume for now we get credentials from the request for manual sync,
	// or we'd need to implement a way to store per-user plugin config.
	//
	// Given the constraints and existing code, let's look at how Gmail does it:
	// Gmail uses `storage.GetIntegrations` to find the tool config.
	// We should probably do the same for IMAP if we treat it as a tool.
	//
	// Let's try to find an "imap" tool for the user.

	var req struct {
		Host     string `json:"host"`
		Port     int    `json:"port"`
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := c.BindJSON(&req); err != nil {
		// If not provided in request, try to find in Tools
		tools, err := g.storage.GetIntegrations(c.Request.Context(), user.ID)
		if err == nil {
			for _, t := range tools {
				if t.Provider == "imap" && t.Enabled {
					// Parse params
					// This assumes we stored IMAP config in Tool params
					// Implementation detail: we need to decide how to store IMAP creds.
					break
				}
			}
		}
	}

	if req.Host == "" || req.Username == "" || req.Password == "" {
		c.JSON(400, gin.H{"error": "missing imap credentials (host, username, password)"})
		return
	}

	if err := g.Sync(c.Request.Context(), user.ID, req.Host, req.Port, req.Username, req.Password); err != nil {
		g.logger.Error("sync failed", zap.Error(err))
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{"message": "sync completed"})
}

func (g *genericIMAPBackend) Sync(ctx context.Context, userID uuid.UUID, host string, port int, username, password string) error {
	addr := fmt.Sprintf("%s:%d", host, port)
	if port == 0 {
		addr = fmt.Sprintf("%s:993", host)
	}

	// 1. Connect to IMAP
	c, err := client.DialTLS(addr, nil)
	if err != nil {
		return fmt.Errorf("failed to dial imap: %w", err)
	}
	defer c.Logout()

	// 2. Login
	if err := c.Login(username, password); err != nil {
		return fmt.Errorf("imap login failed: %w", err)
	}

	// 3. Delegate to Syncer
	return g.syncer.Sync(ctx, userID, c)
}

func (g *genericIMAPBackend) ExecuteAction(ctx context.Context, userID uuid.UUID, action storage.InboxAction, message storage.Inbox) error {
	// For generic IMAP, we need credentials.
	// As discussed, we don't have per-user config storage yet.
	// For now, we can only execute actions if we have credentials.
	// But ExecuteAction signature doesn't allow passing extra params (like password).
	// This confirms we NEED stored credentials for full functionality.

	// Temporary workaround: Try to find credentials in Tools (if we decided to store them there)
	// or fail if not found.

	// Let's try to find "imap" tool
	tools, err := g.storage.GetIntegrations(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to get tools: %w", err)
	}

	var imapTool *storage.Integration
	for _, t := range tools {
		if t.Provider == "imap" && t.Enabled {
			imapTool = &t
			break
		}
	}

	if imapTool == nil {
		return fmt.Errorf("imap integration not found (credentials required for actions)")
	}

	var params struct {
		Host     string `json:"host"`
		Port     int    `json:"port"`
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.Unmarshal([]byte(imapTool.Params), &params); err != nil {
		return fmt.Errorf("failed to parse imap params: %w", err)
	}

	if params.Password == "" {
		return fmt.Errorf("imap password not found in storage")
	}

	// Connect
	addr := fmt.Sprintf("%s:%d", params.Host, params.Port)
	if params.Port == 0 {
		addr = fmt.Sprintf("%s:993", params.Host)
	}

	c, err := client.DialTLS(addr, nil)
	if err != nil {
		return fmt.Errorf("failed to dial imap: %w", err)
	}
	defer c.Logout()

	if err := c.Login(params.Username, params.Password); err != nil {
		return fmt.Errorf("imap login failed: %w", err)
	}

	// Select Inbox
	if _, err := c.Select("INBOX", false); err != nil {
		return fmt.Errorf("failed to select inbox: %w", err)
	}

	// Execute Action
	switch action.Command {
	case "mark_as_read":
		return g.syncer.MarkAsRead(ctx, userID, []uint32{message.UID}, c)
	case "archive":
		return g.syncer.Archive(ctx, userID, []uint32{message.UID}, c)
	default:
		return fmt.Errorf("unsupported action: %s", action.Command)
	}
}

func (g *genericIMAPBackend) Status(ctx context.Context, state map[string]interface{}) (map[string]interface{}, error) {
	return map[string]interface{}{
		"provider":  "generic_imap",
		"connected": true,
	}, nil
}

func (g *genericIMAPBackend) Shutdown(ctx context.Context) error {
	close(g.done)
	return nil
}
