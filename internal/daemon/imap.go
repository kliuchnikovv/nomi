package daemon

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
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

		d.logger.Info("connecting watcher...", zap.String("tool_id", tool.ID.String()))
		if err := d.connectAndListen(ctx, tool); err != nil {
			d.logger.Error("watcher error, retrying in 30s", zap.String("tool_id", tool.ID.String()), zap.Error(err))
			select {
			case <-ctx.Done():
				return
			case <-time.After(30 * time.Second):
				continue
			}
		} else {
			d.logger.Info("watcher finished cleanly, restarting in 1s", zap.String("tool_id", tool.ID.String()))
			// Prevent tight loop if connectAndListen returns nil immediately
			select {
			case <-ctx.Done():
				return
			case <-time.After(1 * time.Second):
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

	d.logger.Info("dialing imap server", zap.String("tool_id", tool.ID.String()))

	dialer := &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	conn, err := tls.DialWithDialer(dialer, "tcp", "imap.gmail.com:993", nil)
	if err != nil {
		return fmt.Errorf("failed to dial: %w", err)
	}

	c, err := client.New(conn)
	if err != nil {
		conn.Close()
		return fmt.Errorf("failed to create client: %w", err)
	}
	// defer c.Logout() - replaced with timeout-aware logout
	defer func() {
		d.logger.Info("closing connection", zap.String("tool_id", tool.ID.String()))

		done := make(chan struct{})
		go func() {
			if err := c.Logout(); err != nil {
				d.logger.Warn("logout error", zap.Error(err))
			}
			close(done)
		}()

		select {
		case <-done:
			d.logger.Info("connection closed cleanly", zap.String("tool_id", tool.ID.String()))
		case <-time.After(5 * time.Second):
			d.logger.Warn("logout timed out, moving on", zap.String("tool_id", tool.ID.String()))
			// We can't easily force close the client if it doesn't expose Close(),
			// but we can unblock the daemon. The underlying connection will eventually timeout.
		}
	}()
	d.logger.Info("connected to imap server", zap.String("tool_id", tool.ID.String()))

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

	d.logger.Info("authenticating", zap.String("tool_id", tool.ID.String()))
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

	d.logger.Info("selecting inbox", zap.String("tool_id", tool.ID.String()))
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
		d.logger.Info("idle command started", zap.String("tool_id", tool.ID.String()))
		done <- c.Idle(stop, nil)
		d.logger.Info("idle command finished", zap.String("tool_id", tool.ID.String()))
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
		case <-time.After(15 * time.Minute):
			d.logger.Info("refreshing idle connection", zap.String("tool_id", tool.ID.String()))
			close(stop)
			// Wait for done or timeout
			select {
			case <-done:
				return nil // Return nil to trigger reconnection in watch loop
			case <-time.After(5 * time.Second):
				d.logger.Warn("idle command close timed out", zap.String("tool_id", tool.ID.String()))
				return nil
			}
		}
	}
}

func (d *IMAPDaemon) fetchNewMessages(ctx context.Context, c *client.Client, userID uuid.UUID) error {
	d.logger.Info("starting fetchNewMessages", zap.String("user_id", userID.String()))

	criteria := imap.NewSearchCriteria()
	criteria.WithoutFlags = []string{imap.SeenFlag}

	d.logger.Info("executing IMAP UID search", zap.String("user_id", userID.String()))
	uids, err := c.UidSearch(criteria)
	if err != nil {
		d.logger.Error("search failed", zap.Error(err), zap.String("user_id", userID.String()))
		return err
	}

	if len(uids) == 0 {
		d.logger.Info("no new messages found", zap.String("user_id", userID.String()))
		return nil
	}

	d.logger.Info("found new messages",
		zap.String("user_id", userID.String()),
		zap.Int("count", len(uids)),
		zap.Uint32s("uids", uids),
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

	// Fetch envelope and body (using PEEK to avoid marking as read)
	// Note: We don't use Partial here because it can cause "short write" errors
	// with some IMAP servers. Instead, we'll truncate on the application side if needed.
	section := &imap.BodySectionName{
		Peek: true,
	}

	items := []imap.FetchItem{imap.FetchEnvelope, imap.FetchBodyStructure, imap.FetchFlags, section.FetchItem()}

	d.logger.Info("starting IMAP fetch",
		zap.String("user_id", userID.String()),
		zap.Int("message_count", len(uids)),
		zap.Uint32s("uids", uids),
	)

	messages := make(chan *imap.Message, 10)
	done := make(chan error, 1)
	go func() {
		d.logger.Debug("fetch goroutine started", zap.String("user_id", userID.String()))
		err := c.UidFetch(seqset, items, messages)
		if err != nil {
			d.logger.Error("fetch returned error", zap.Error(err), zap.String("user_id", userID.String()))
		} else {
			d.logger.Debug("fetch completed successfully", zap.String("user_id", userID.String()))
		}
		done <- err
	}()

	processedCount := 0
	for msg := range messages {
		processedCount++
		d.logger.Debug("processing message",
			zap.String("user_id", userID.String()),
			zap.Int("message_num", processedCount),
			zap.Uint32("uid", msg.Uid),
		)
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

		if err := d.imapService.SaveMessage(ctx, userID, msg, section); err != nil {
			d.logger.Error("failed to save message",
				zap.String("user_id", userID.String()),
				zap.String("from", sender),
				zap.String("subject", subject),
				zap.Error(err),
			)
		} else {
			d.logger.Debug("message saved successfully",
				zap.String("user_id", userID.String()),
				zap.String("from", sender),
				zap.String("subject", subject),
				zap.Uint32("uid", msg.Uid),
			)
		}
	}

	d.logger.Info("finished processing messages",
		zap.String("user_id", userID.String()),
		zap.Int("processed", processedCount),
	)

	fetchErr := <-done
	if fetchErr != nil {
		d.logger.Error("fetch operation failed",
			zap.Error(fetchErr),
			zap.String("user_id", userID.String()),
			zap.Int("processed_before_error", processedCount),
		)
	}
	return fetchErr
}
