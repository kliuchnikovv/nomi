package integrations

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

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
	uids, err := c.Search(criteria)
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
	items := []imap.FetchItem{imap.FetchEnvelope, section.FetchItem()}

	messages := make(chan *imap.Message, 10)
	done := make(chan error, 1)
	go func() {
		done <- c.Fetch(seqset, items, messages)
	}()

	for msg := range messages {
		if err := s.ProcessMessage(ctx, userID, msg, section); err != nil {
			s.logger.Error("failed to process message", zap.Error(err))
		}
	}

	if err := <-done; err != nil {
		return fmt.Errorf("fetch failed: %w", err)
	}

	return nil
}

func (s *GmailIMAPService) ProcessMessage(ctx context.Context, userID uuid.UUID, msg *imap.Message, section *imap.BodySectionName) error {
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
			b, err := io.ReadAll(r)
			if err == nil {
				body = string(b)
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

	inboxItem := &storage.Inbox{
		UserID:     userID,
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

	// Process with LLM
	s.logger.Info("generating llm summary", zap.String("subject", inboxItem.Subject))
	prompt := fmt.Sprintf("Analyze this email:\nFrom: %s\nSubject: %s\nBody: %s\n\nProvide a summary and suggested action.", inboxItem.Sender, inboxItem.Subject, inboxItem.Body)
	response, err := s.llmService.GenerateSimple(ctx, userID, prompt)
	if err != nil {
		s.logger.Error("failed to generate llm response", zap.Error(err))
		inboxItem.Status = "failed"
	} else {
		inboxItem.Response = response
		inboxItem.Status = "processed"
		s.logger.Info("llm summary generated", zap.String("response_length", fmt.Sprintf("%d", len(response))))
	}

	if err := s.storage.DB.Save(inboxItem).Error; err != nil {
		return fmt.Errorf("failed to update inbox item: %w", err)
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
