package integrations

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/llm"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

type GmailIMAPService struct {
	logger     *zap.Logger
	storage    *storage.Storage
	llmService *llm.Service
}

func NewGmailIMAPService(logger *zap.Logger, store *storage.Storage, llmSvc *llm.Service) *GmailIMAPService {
	return &GmailIMAPService{
		logger:     logger.With(zap.String("component", "gmail_imap")),
		storage:    store,
		llmService: llmSvc,
	}
}

func (s *GmailIMAPService) Sync(ctx context.Context, userID uuid.UUID) error {
	// 1. Get Gmail tool params
	tools, err := s.storage.GetTools(ctx, userID)
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
	oauthToken, err := s.storage.GetOAuthTokenByUser(ctx, userID, "gmail")
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

	// 3. Select Inbox
	_, err = c.Select("INBOX", false)
	if err != nil {
		return fmt.Errorf("failed to select inbox: %w", err)
	}

	// 4. Fetch UNSEEN messages
	criteria := imap.NewSearchCriteria()
	criteria.WithoutFlags = []string{imap.SeenFlag}
	uids, err := c.UidSearch(criteria)
	if err != nil {
		return fmt.Errorf("failed to search messages: %w", err)
	}

	if len(uids) == 0 {
		s.logger.Info("no new messages")
		return nil
	}

	seqset := new(imap.SeqSet)
	seqset.AddNum(uids...)

	section := &imap.BodySectionName{}
	items := []imap.FetchItem{imap.FetchEnvelope, section.FetchItem(), imap.FetchUid, "X-GM-THRID"}

	messages := make(chan *imap.Message, 10)
	done := make(chan error, 1)
	go func() {
		done <- c.UidFetch(seqset, items, messages)
	}()

	for msg := range messages {
		if err := s.SaveMessage(ctx, userID, msg, section); err != nil {
			s.logger.Error("failed to save message", zap.Error(err))
		}
	}

	if err := <-done; err != nil {
		return fmt.Errorf("fetch failed: %w", err)
	}

	return nil
}

func (s *GmailIMAPService) SaveMessage(ctx context.Context, userID uuid.UUID, msg *imap.Message, section *imap.BodySectionName) error {
	if msg.Envelope == nil {
		return fmt.Errorf("message envelope is nil")
	}

	sender := ""
	if len(msg.Envelope.From) > 0 {
		sender = msg.Envelope.From[0].Address()
	}

	// Try to get body if available, but don't fail if not
	body := ""
	if section != nil {
		r := msg.GetBody(section)
		if r != nil {
			// Read up to 50KB to avoid memory issues with huge emails
			const maxBodySize = 50 * 1024
			limitedReader := io.LimitReader(r, maxBodySize)
			b, err := io.ReadAll(limitedReader)
			if err == nil {
				body = string(b)
				if len(b) == maxBodySize {
					s.logger.Info("email body truncated",
						zap.Int("size", maxBodySize),
						zap.String("subject", msg.Envelope.Subject))
				}
			} else {
				s.logger.Warn("failed to read message body, will process without it", zap.Error(err))
			}
		}
	}

	// If no body available, use subject as minimal content
	if body == "" {
		s.logger.Warn("body not available, using subject", zap.String("subject", msg.Envelope.Subject))
		body = fmt.Sprintf("Subject: %s\n(Body not available)", msg.Envelope.Subject)
	} else {
		s.logger.Info("body fetched", zap.Int("length", len(body)))
	}

	// Check for duplicates
	var count int64
	if err := s.storage.DB.Model(&storage.Inbox{}).
		Where("user_id = ? AND message_id = ?", userID, msg.Envelope.MessageId).
		Count(&count).Error; err != nil {
		return fmt.Errorf("failed to check for duplicates: %w", err)
	}

	if count > 0 {
		s.logger.Info("skipping duplicate message",
			zap.String("message_id", msg.Envelope.MessageId),
			zap.String("subject", msg.Envelope.Subject))
		return nil
	}

	// Extract Gmail Thread ID from X-GM-THRID
	// The Thread ID might be in msg.Items as a raw value
	var threadID uint64
	s.logger.Debug("message items", zap.Any("items", msg.Items), zap.Uint32("uid", msg.Uid))

	if msg.Items != nil {
		// Try to get X-GM-THRID from Items
		for key, value := range msg.Items {
			s.logger.Debug("item", zap.String("key", string(key)), zap.Any("value", value), zap.String("type", fmt.Sprintf("%T", value)))

			if key == "X-GM-THRID" {
				s.logger.Info("found X-GM-THRID", zap.Any("value", value), zap.String("type", fmt.Sprintf("%T", value)))

				// Try different type assertions
				switch v := value.(type) {
				case uint64:
					threadID = v
				case uint32:
					threadID = uint64(v)
				case int64:
					threadID = uint64(v)
				case int:
					threadID = uint64(v)
				case string:
					// Try parsing as string
					if parsed, err := fmt.Sscanf(v, "%d", &threadID); err == nil && parsed == 1 {
						s.logger.Info("parsed thread ID from string", zap.Uint64("thread_id", threadID))
					}
				default:
					s.logger.Warn("unexpected X-GM-THRID type", zap.String("type", fmt.Sprintf("%T", v)))
				}
				break
			}
		}

		if threadID == 0 {
			s.logger.Warn("X-GM-THRID not found or zero")
		}
	} else {
		s.logger.Warn("msg.Items is nil")
	}

	inboxItem := &storage.Inbox{
		UserID:     userID,
		MessageID:  msg.Envelope.MessageId,
		UID:        msg.Uid,
		ThreadID:   threadID,
		Sender:     sender,
		Subject:    msg.Envelope.Subject,
		Snippet:    "", // TODO: extract snippet
		Body:       body,
		Status:     "pending",
		ReceivedAt: msg.Envelope.Date,
	}

	if err := s.storage.DB.Create(inboxItem).Error; err != nil {
		return fmt.Errorf("failed to save inbox item: %w", err)
	}

	s.logger.Info("message saved to inbox",
		zap.String("subject", inboxItem.Subject),
		zap.Uint64("thread_id", threadID))
	return nil
}

func (s *GmailIMAPService) ProcessPendingItems(ctx context.Context) error {
	var items []storage.Inbox
	if err := s.storage.DB.Where("status = ?", "pending").Find(&items).Error; err != nil {
		return fmt.Errorf("failed to fetch pending items: %w", err)
	}

	if len(items) == 0 {
		return nil
	}

	s.logger.Info("processing pending items", zap.Int("count", len(items)))

	// Group items by UserID to batch IMAP operations
	itemsByUser := make(map[uuid.UUID][]storage.Inbox)
	for _, item := range items {
		itemsByUser[item.UserID] = append(itemsByUser[item.UserID], item)
	}

	for userID, userItems := range itemsByUser {
		var uidsToMarkRead []uint32

		for i := range userItems {
			item := &userItems[i] // Use pointer to modify item
			s.logger.Info("generating llm summary", zap.String("subject", item.Subject))

			// Construct Gmail URL using Thread ID
			// Format: https://mail.google.com/mail/u/0/#inbox/{thread_id_in_hex}
			gmailURL := ""
			if item.ThreadID > 0 {
				gmailURL = fmt.Sprintf("https://mail.google.com/mail/u/0/#inbox/%x", item.ThreadID)
			}

			prompt := fmt.Sprintf(`From: %s
Subject: %s
Gmail URL: %s
Body: %s`, item.Sender, item.Subject, gmailURL, item.Body)

			response, err := s.llmService.GenerateSimple(ctx, item.UserID, prompt, "mailer")
			if err != nil {
				s.logger.Error("failed to generate llm response", zap.Error(err))
				item.Status = "failed"
			} else {
				// Strip markdown code blocks if present
				cleanResponse := response
				if len(cleanResponse) > 7 && cleanResponse[:7] == "```json" {
					cleanResponse = cleanResponse[7:]
				} else if len(cleanResponse) > 3 && cleanResponse[:3] == "```" {
					cleanResponse = cleanResponse[3:]
				}
				if len(cleanResponse) > 3 && cleanResponse[len(cleanResponse)-3:] == "```" {
					cleanResponse = cleanResponse[:len(cleanResponse)-3]
				}

				// Validate JSON structure
				var analysis storage.InboxAnalysis
				if err := json.Unmarshal([]byte(cleanResponse), &analysis); err != nil {
					s.logger.Error("failed to parse llm response as json",
						zap.Error(err),
						zap.String("response", response))
					item.Response = response
					item.Status = "processed"
				} else {
					s.logger.Info("llm analysis parsed successfully",
						zap.String("title", analysis.Title),
						zap.String("importance", analysis.Importance.Level),
						zap.Any("actions", analysis.Actions))

					// Save the cleaned JSON response
					item.Response = strings.Trim(cleanResponse, "\t\n ")
					item.Status = "processed"

					// If importance is low, add to list to mark as read
					if analysis.Importance.Level == "low" && item.UID > 0 {
						uidsToMarkRead = append(uidsToMarkRead, item.UID)
					}
				}
			}

			if err := s.storage.DB.Save(item).Error; err != nil {
				s.logger.Error("failed to update inbox item", zap.Error(err))
			}
		}

		// Batch mark as read for this user
		if len(uidsToMarkRead) > 0 {
			s.logger.Info("marking low priority messages as read",
				zap.String("user_id", userID.String()),
				zap.Int("count", len(uidsToMarkRead)))
			if err := s.MarkMessagesAsRead(ctx, userID, uidsToMarkRead); err != nil {
				s.logger.Error("failed to mark messages as read", zap.Error(err))
			}
		}
	}

	return nil
}

func (s *GmailIMAPService) MarkMessagesAsRead(ctx context.Context, userID uuid.UUID, uids []uint32) error {
	// 1. Get Gmail tool params
	tools, err := s.storage.GetTools(ctx, userID)
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
	oauthToken, err := s.storage.GetOAuthTokenByUser(ctx, userID, "gmail")
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

	// 3. Select Inbox
	_, err = c.Select("INBOX", false)
	if err != nil {
		return fmt.Errorf("failed to select inbox: %w", err)
	}

	// 4. Mark messages as read
	seqset := new(imap.SeqSet)
	seqset.AddNum(uids...)

	item := imap.FormatFlagsOp(imap.AddFlags, true)
	flags := []interface{}{imap.SeenFlag}

	if err := c.UidStore(seqset, item, flags, nil); err != nil {
		return fmt.Errorf("failed to mark messages as read: %w", err)
	}

	return nil
}

// Xoauth2Client implements sasl.Client for XOAUTH2
type Xoauth2Client struct {
	Username string
	Token    string
}

func (a *Xoauth2Client) Start() (mech string, ir []byte, err error) {
	mech = "XOAUTH2"
	ir = []byte("user=" + a.Username + "\x01auth=Bearer " + a.Token + "\x01\x01")
	return
}

func (a *Xoauth2Client) Next(challenge []byte) (response []byte, err error) {
	return []byte{}, nil
}
