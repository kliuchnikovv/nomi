package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/integrations"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
)

type IMAPDaemon struct {
	logger       *zap.Logger
	storage      *storage.Storage
	imapService  *integrations.GmailIMAPService
	oauthConfigs map[string]*oauth2.Config

	mu          sync.RWMutex
	connections map[uuid.UUID]*toolWatcher
}

type toolWatcher struct {
	toolID uuid.UUID
	userID uuid.UUID
	cancel context.CancelFunc
}

func NewIMAPDaemon(logger *zap.Logger, store *storage.Storage, imapService *integrations.GmailIMAPService, oauthConfigs map[string]*oauth2.Config) *IMAPDaemon {
	return &IMAPDaemon{
		logger:       logger.With(zap.String("component", "imap_daemon")),
		storage:      store,
		imapService:  imapService,
		oauthConfigs: oauthConfigs,
		connections:  make(map[uuid.UUID]*toolWatcher),
	}
}

func (d *IMAPDaemon) Start(ctx context.Context) error {
	d.logger.Info("starting imap daemon")

	// Load all enabled gmail tools
	var tools []storage.Tool
	if err := d.storage.DB.Where("provider = ? AND enabled = ?", "gmail", true).Find(&tools).Error; err != nil {
		return fmt.Errorf("failed to load tools: %w", err)
	}

	for _, t := range tools {
		d.AddTool(ctx, t)
	}

	return nil
}

func (d *IMAPDaemon) AddTool(ctx context.Context, tool storage.Tool) {
	if tool.Provider != "gmail" || !tool.Enabled {
		d.logger.Debug("skipping tool (not gmail or disabled)",
			zap.String("tool_id", tool.ID.String()),
			zap.String("provider", tool.Provider),
			zap.Bool("enabled", tool.Enabled),
		)
		return
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	if _, exists := d.connections[tool.ID]; exists {
		d.logger.Info("tool already watched", zap.String("tool_id", tool.ID.String()))
		return
	}

	d.logger.Info("adding tool to watch",
		zap.String("tool_id", tool.ID.String()),
		zap.String("user_id", tool.UserID.String()),
		zap.String("name", tool.Name),
	)

	ctx, cancel := context.WithCancel(context.Background()) // Use background context for long-running watcher
	watcher := &toolWatcher{
		toolID: tool.ID,
		userID: tool.UserID,
		cancel: cancel,
	}
	d.connections[tool.ID] = watcher

	go d.watch(ctx, tool)
}

func (d *IMAPDaemon) RemoveTool(toolID uuid.UUID) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if watcher, exists := d.connections[toolID]; exists {
		d.logger.Info("removing tool from watch",
			zap.String("tool_id", toolID.String()),
			zap.String("user_id", watcher.userID.String()),
		)
		watcher.cancel()
		delete(d.connections, toolID)
		d.logger.Info("tool removed successfully", zap.String("tool_id", toolID.String()))
	} else {
		d.logger.Warn("attempted to remove non-existent tool", zap.String("tool_id", toolID.String()))
	}
}

func (d *IMAPDaemon) UpdateTool(ctx context.Context, tool storage.Tool) {
	d.RemoveTool(tool.ID)
	d.AddTool(ctx, tool)
}

func (d *IMAPDaemon) watch(ctx context.Context, tool storage.Tool) {
	d.logger.Info("starting watcher for tool", zap.String("tool_id", tool.ID.String()))
	defer d.logger.Info("stopped watcher for tool", zap.String("tool_id", tool.ID.String()))

	// Retry loop
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		if err := d.connectAndListen(ctx, tool); err != nil {
			d.logger.Error("watcher error, retrying in 30s", zap.String("tool_id", tool.ID.String()), zap.Error(err))
			select {
			case <-ctx.Done():
				return
			case <-time.After(30 * time.Second):
				continue
			}
		}
	}
}

func (d *IMAPDaemon) connectAndListen(ctx context.Context, tool storage.Tool) error {
	var params struct {
		Creds struct {
			Token string `json:"token"`
		} `json:"creds"`
	}
	if err := json.Unmarshal([]byte(tool.Params), &params); err != nil {
		return fmt.Errorf("failed to parse params: %w", err)
	}

	if params.Creds.Token == "" {
		return fmt.Errorf("no token found")
	}

	c, err := client.DialTLS("imap.gmail.com:993", nil)
	if err != nil {
		return fmt.Errorf("failed to dial: %w", err)
	}
	defer c.Logout()

	// Authenticate
	oauthToken, err := d.storage.GetOAuthTokenByUser(ctx, tool.UserID, "gmail")
	if err != nil {
		return fmt.Errorf("failed to get oauth token: %w", err)
	}

	// Refresh token if needed
	var token oauth2.Token
	if err := json.Unmarshal(oauthToken.TokenEncrypted, &token); err != nil {
		return fmt.Errorf("failed to unmarshal token: %w", err)
	}

	d.logger.Info("checking token",
		zap.String("tool_id", tool.ID.String()),
		zap.Time("expiry", token.Expiry),
		zap.Bool("has_refresh_token", token.RefreshToken != ""),
	)

	// Map "gmail" provider to "google" config
	configName := "gmail"
	if _, ok := d.oauthConfigs["gmail"]; !ok {
		if _, ok := d.oauthConfigs["google"]; ok {
			configName = "google"
		}
	}

	conf, ok := d.oauthConfigs[configName]
	if !ok {
		return fmt.Errorf("oauth config not found for provider: %s (tried gmail and google)", configName)
	}

	tokenSource := conf.TokenSource(ctx, &token)
	newToken, err := tokenSource.Token()
	if err != nil {
		return fmt.Errorf("failed to refresh token: %w", err)
	}

	if newToken.AccessToken != token.AccessToken {
		d.logger.Info("token refreshed", zap.String("tool_id", tool.ID.String()))
		// Save new token
		tokenBytes, _ := json.Marshal(newToken)
		oauthToken.TokenEncrypted = tokenBytes
		oauthToken.UpdatedAt = time.Now().UTC()
		if err := d.storage.UpdateOAuthToken(ctx, oauthToken); err != nil {
			d.logger.Error("failed to save refreshed token", zap.Error(err))
		}
	} else {
		d.logger.Info("token not refreshed (valid)", zap.String("tool_id", tool.ID.String()))
	}

	saslClient := &integrations.Xoauth2Client{
		Username: oauthToken.AccountEmail,
		Token:    newToken.AccessToken,
	}

	if err := c.Authenticate(saslClient); err != nil {
		d.logger.Warn("initial auth failed, trying force refresh", zap.Error(err))

		// Force refresh by setting expiry to past
		token.Expiry = time.Now().Add(-1 * time.Hour)
		tokenSource := conf.TokenSource(ctx, &token)
		refreshedToken, err := tokenSource.Token()
		if err != nil {
			return fmt.Errorf("failed to force refresh token: %w", err)
		}

		if refreshedToken.AccessToken != newToken.AccessToken {
			d.logger.Info("token force refreshed", zap.String("tool_id", tool.ID.String()))
			tokenBytes, _ := json.Marshal(refreshedToken)
			oauthToken.TokenEncrypted = tokenBytes
			oauthToken.UpdatedAt = time.Now().UTC()
			if err := d.storage.UpdateOAuthToken(ctx, oauthToken); err != nil {
				d.logger.Error("failed to save force refreshed token", zap.Error(err))
			}

			saslClient.Token = refreshedToken.AccessToken
			if err := c.Authenticate(saslClient); err != nil {
				return fmt.Errorf("auth failed after refresh: %w", err)
			}
		} else {
			return fmt.Errorf("auth failed and token not refreshed: %w", err)
		}
	}

	if _, err := c.Select("INBOX", false); err != nil {
		return fmt.Errorf("failed to select inbox: %w", err)
	}

	// Create a channel to receive mailbox updates
	updates := make(chan client.Update)
	c.Updates = updates

	// Start IDLE
	stop := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- c.Idle(stop, nil)
	}()

	d.logger.Info("idling...", zap.String("tool_id", tool.ID.String()))

	// Initial fetch - not critical, continue even if it fails
	d.logger.Info("performing initial message fetch", zap.String("tool_id", tool.ID.String()))
	if err := d.fetchNewMessages(ctx, c, tool.UserID); err != nil {
		d.logger.Warn("initial fetch failed, continuing with IDLE", zap.String("tool_id", tool.ID.String()), zap.Error(err))
		// Don't return error - we can still listen for new messages via IDLE
	}

	for {
		select {
		case <-ctx.Done():
			close(stop)
			return nil
		case update := <-updates:
			if _, ok := update.(*client.MailboxUpdate); ok {
				d.logger.Info("mailbox updated", zap.String("tool_id", tool.ID.String()))
				if err := d.fetchNewMessages(ctx, c, tool.UserID); err != nil {
					d.logger.Error("fetch failed", zap.Error(err))
				}
			}
		case err := <-done:
			return err
		}
	}
}

func (d *IMAPDaemon) fetchNewMessages(ctx context.Context, c *client.Client, userID uuid.UUID) error {
	criteria := imap.NewSearchCriteria()
	criteria.WithoutFlags = []string{imap.SeenFlag}
	uids, err := c.Search(criteria)
	if err != nil {
		return err
	}

	if len(uids) == 0 {
		d.logger.Debug("no new messages found", zap.String("user_id", userID.String()))
		return nil
	}

	d.logger.Info("found new messages",
		zap.String("user_id", userID.String()),
		zap.Int("count", len(uids)),
	)

	// Limit to prevent overloading - process max 50 messages at a time
	const maxMessagesPerFetch = 50
	if len(uids) > maxMessagesPerFetch {
		d.logger.Warn("limiting message fetch",
			zap.String("user_id", userID.String()),
			zap.Int("total", len(uids)),
			zap.Int("fetching", maxMessagesPerFetch),
		)
		uids = uids[:maxMessagesPerFetch]
	}

	seqset := new(imap.SeqSet)
	seqset.AddNum(uids...)

	// Fetch envelope and partial body (first 40KB) to allow summary generation
	// while avoiding "short write" errors on large emails
	section := &imap.BodySectionName{
		Peek:    true,
		Partial: []int{0, 40000}, // Fetch first 40KB
	}

	items := []imap.FetchItem{imap.FetchEnvelope, imap.FetchBodyStructure, imap.FetchFlags, section.FetchItem()}

	messages := make(chan *imap.Message, 10)
	done := make(chan error, 1)
	go func() {
		done <- c.Fetch(seqset, items, messages)
	}()

	for msg := range messages {
		subject := ""
		sender := ""
		if msg.Envelope != nil {
			subject = msg.Envelope.Subject
			if len(msg.Envelope.From) > 0 {
				sender = msg.Envelope.From[0].Address()
			}
		}

		d.logger.Info("processing message",
			zap.String("user_id", userID.String()),
			zap.String("from", sender),
			zap.String("subject", subject),
		)

		if err := d.imapService.ProcessMessage(ctx, userID, msg, section); err != nil {
			d.logger.Error("failed to process message",
				zap.String("user_id", userID.String()),
				zap.String("from", sender),
				zap.String("subject", subject),
				zap.Error(err),
			)
		} else {
			d.logger.Info("message processed successfully",
				zap.String("user_id", userID.String()),
				zap.String("from", sender),
				zap.String("subject", subject),
			)
		}
	}

	return <-done
}
