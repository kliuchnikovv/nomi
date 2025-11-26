package plugins

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/actions"
	"github.com/kliuchnikovv/genie-api/internal/llm"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

type EmailSyncer struct {
	logger        *zap.Logger
	storage       *storage.Storage
	llmService    *llm.Service
	actionBuilder *actions.Builder
	source        string
}

func NewEmailSyncer(logger *zap.Logger, store *storage.Storage, llmSvc *llm.Service, source string) *EmailSyncer {
	return &EmailSyncer{
		logger:        logger.With(zap.String("component", "email_syncer"), zap.String("source", source)),
		storage:       store,
		llmService:    llmSvc,
		actionBuilder: actions.NewBuilder(logger),
		source:        source,
	}
}

func (s *EmailSyncer) cleanLLMResponse(resp string) string {
	resp = strings.TrimSpace(resp)

	// Remove markdown code fences (with or without language tags)
	if strings.HasPrefix(resp, "```") {
		trimmed := strings.TrimPrefix(resp, "```")
		if newline := strings.Index(trimmed, "\n"); newline >= 0 {
			trimmed = trimmed[newline+1:]
		} else {
			// No newline, drop the possible language tag and continue
			trimmed = strings.TrimLeft(trimmed, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
		}
		resp = trimmed
	}
	if strings.HasSuffix(resp, "```") {
		resp = strings.TrimSuffix(resp, "```")
	}

	// If extra text wraps the JSON, keep only the JSON object/array portion
	if start := strings.Index(resp, "{"); start >= 0 {
		if end := strings.LastIndex(resp, "}"); end >= start {
			resp = resp[start : end+1]
		}
	}

	return strings.TrimSpace(resp)
}

func (s *EmailSyncer) Sync(ctx context.Context, userID uuid.UUID, c *client.Client) error {
	// 1. Select Inbox
	_, err := c.Select("INBOX", false)
	if err != nil {
		return fmt.Errorf("failed to select inbox: %w", err)
	}

	// 2. Fetch UNSEEN messages
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
	items := []imap.FetchItem{imap.FetchEnvelope, section.FetchItem(), imap.FetchUid, "X-GM-THRID", imap.FetchFlags, imap.FetchInternalDate}

	messages := make(chan *imap.Message, 10)
	done := make(chan error, 1)
	go func() {
		done <- c.UidFetch(seqset, items, messages)
	}()

	var newMessages []storage.Inbox
	for msg := range messages {
		if item, err := s.saveMessage(ctx, userID, msg, section); err != nil {
			s.logger.Error("failed to save message", zap.Error(err))
		} else if item != nil {
			newMessages = append(newMessages, *item)
		}
	}

	if err := <-done; err != nil {
		return fmt.Errorf("fetch failed: %w", err)
	}

	// 3. Process new messages with LLM
	if len(newMessages) > 0 {
		if err := s.processMessages(ctx, userID, newMessages, c); err != nil {
			s.logger.Error("failed to process messages with LLM", zap.Error(err))
		}
	}

	return nil
}

func (s *EmailSyncer) saveMessage(ctx context.Context, userID uuid.UUID, msg *imap.Message, section *imap.BodySectionName) (*storage.Inbox, error) {
	if msg == nil {
		s.logger.Warn("skipping nil message from IMAP")
		return nil, nil
	}

	if msg.Envelope == nil {
		s.logger.Warn("skipping message with nil envelope", zap.Uint32("uid", msg.Uid))
		return nil, nil
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
	}

	// Check for duplicates
	var count int64
	if err := s.storage.DB.Model(&storage.Inbox{}).
		Where("user_id = ? AND message_id = ?", userID, msg.Envelope.MessageId).
		Count(&count).Error; err != nil {
		return nil, fmt.Errorf("failed to check for duplicates: %w", err)
	}

	if count > 0 {
		s.logger.Info("skipping duplicate message",
			zap.String("message_id", msg.Envelope.MessageId),
			zap.String("subject", msg.Envelope.Subject))
		return nil, nil
	}

	// Extract Gmail Thread ID from X-GM-THRID
	var threadID uint64
	if msg.Items != nil {
		for key, value := range msg.Items {
			if key == "X-GM-THRID" {
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
					if parsed, err := fmt.Sscanf(v, "%d", &threadID); err == nil && parsed == 1 {
						s.logger.Info("parsed thread ID from string", zap.Uint64("thread_id", threadID))
					}
				}
				break
			}
		}
	}

	inboxItem := &storage.Inbox{
		UserID:     userID,
		Source:     s.source,
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
		return nil, fmt.Errorf("failed to save inbox item: %w", err)
	}

	s.logger.Info("message saved to inbox",
		zap.String("subject", inboxItem.Subject),
		zap.Uint64("thread_id", threadID))
	return inboxItem, nil
}

func (s *EmailSyncer) processMessages(ctx context.Context, userID uuid.UUID, items []storage.Inbox, c *client.Client) error {
	s.logger.Info("processing pending items", zap.Int("count", len(items)))

	var uidsToMarkRead []uint32

	for i := range items {
		item := &items[i]
		s.logger.Info("analyzing message", zap.String("subject", item.Subject))

		// Call LLM to analyze importance, urgency, summary, and suggest actions
		prompt := fmt.Sprintf(`Analyze this email and provide:
1. Importance level (high/medium/low) with reason
2. Urgency level (urgent/soon/can_wait) with reason
3. A 2-3 sentence summary
4. Suggest 1-2 smart context-aware actions the user might want to take

Examples of smart actions:
- "Reply with availability" if someone asks for a meeting
- "Add to calendar" if there's an event mentioned
- "Create task" if there's a request or TODO
- "Forward to team" if it's relevant to others
- "Save attachment" if there are important files

Email:
From: %s
Subject: %s
Body:
%s

Respond ONLY with valid JSON in this format:
{
  "title": "%s",
  "importance": {"level": "high|medium|low", "reason": "short reason"},
  "urgency": {"level": "urgent|soon|can_wait", "reason": "short reason"},
  "summary": "2-3 sentence summary",
  "suggested_actions": [
    {"label": "Action label", "command": "action_command", "why": "why this action makes sense", "prompt": "detailed prompt for executing this action"}
  ]
}

Note: suggested_actions is optional. Only suggest actions if they make sense for this email. Each action should have:
- label: Short, user-friendly action name
- command: One of: reply, forward, create_task, add_to_calendar, save_attachment, or custom
- why: Brief explanation of why this action is relevant
- prompt: Detailed instruction for executing the action (what to say in reply, what task to create, etc.)
`, item.Sender, item.Subject, item.Body, item.Subject)

		llmResponse, err := s.llmService.GenerateSimple(ctx, userID, prompt, "mailer")
		if err != nil {
			s.logger.Error("failed to get LLM analysis", zap.Error(err))
			// Continue with empty analysis
			llmResponse = fmt.Sprintf(`{"title": "%s", "importance": {"level": "medium", "reason": "Unable to analyze"}, "urgency": {"level": "can_wait", "reason": "Unable to analyze"}, "summary": "Email analysis unavailable"}`, item.Subject)
		}

		// Clean LLM response (strip markdown)
		llmResponse = s.cleanLLMResponse(llmResponse)

		// Parse LLM response
		var llmAnalysis storage.InboxAnalysis
		if err := json.Unmarshal([]byte(llmResponse), &llmAnalysis); err != nil {
			s.logger.Error("failed to parse LLM response", zap.Error(err), zap.String("response", llmResponse))
			// Use default values
			llmAnalysis = storage.InboxAnalysis{
				Title: item.Subject,
				Importance: storage.InboxLevel{
					Level:  "medium",
					Reason: "Unable to parse analysis",
				},
				Urgency: storage.InboxLevel{
					Level:  "can_wait",
					Reason: "Unable to parse analysis",
				},
				Summary: "Email analysis unavailable",
			}
		}

		// Build base actions using ActionBuilder
		baseActions := s.actionBuilder.BuildActions(item)

		// Merge base actions with LLM-suggested actions
		allActions := baseActions
		if len(llmAnalysis.Actions) > 0 {
			// LLM suggested some actions - add them after base actions
			s.logger.Info("adding LLM-suggested actions",
				zap.Int("count", len(llmAnalysis.Actions)),
				zap.String("subject", item.Subject))

			// Set agent to "mailer" for all LLM-suggested actions
			for i := range llmAnalysis.Actions {
				if llmAnalysis.Actions[i].Agent == "" {
					llmAnalysis.Actions[i].Agent = "mailer"
				}
			}

			allActions = append(allActions, llmAnalysis.Actions...)
		}

		// Combine LLM analysis with merged actions
		analysis := storage.InboxAnalysis{
			Title:       llmAnalysis.Title,
			Importance:  llmAnalysis.Importance,
			Urgency:     llmAnalysis.Urgency,
			Summary:     llmAnalysis.Summary,
			Actions:     allActions,
			MissingInfo: llmAnalysis.MissingInfo,
		}

		jsonData, err := json.Marshal(analysis)
		if err != nil {
			s.logger.Error("failed to marshal analysis", zap.Error(err))
			item.Response = ""
		} else {
			item.Response = string(jsonData)
		}
		item.Status = "processed"

		// Add UID to list for marking as read if low priority
		if item.UID > 0 && llmAnalysis.Importance.Level == "low" {
			uidsToMarkRead = append(uidsToMarkRead, item.UID)
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

		seqset := new(imap.SeqSet)
		seqset.AddNum(uidsToMarkRead...)

		item := imap.FormatFlagsOp(imap.AddFlags, true)
		flags := []interface{}{imap.SeenFlag}

		if err := c.UidStore(seqset, item, flags, nil); err != nil {
			s.logger.Error("failed to mark messages as read on IMAP", zap.Error(err))
		}
	}

	return nil
}

func (s *EmailSyncer) MarkAsRead(ctx context.Context, userID uuid.UUID, uids []uint32, c *client.Client) error {
	if len(uids) == 0 {
		return nil
	}

	seqset := new(imap.SeqSet)
	seqset.AddNum(uids...)

	item := imap.FormatFlagsOp(imap.AddFlags, true)
	flags := []interface{}{imap.SeenFlag}

	if err := c.UidStore(seqset, item, flags, nil); err != nil {
		return fmt.Errorf("failed to mark messages as read on IMAP: %w", err)
	}

	return nil
}

func (s *EmailSyncer) Archive(ctx context.Context, userID uuid.UUID, uids []uint32, c *client.Client) error {
	// Simplified implementation: Just logging for now as archiving logic varies greatly
	s.logger.Info("archive action requested (not fully implemented)", zap.Int("count", len(uids)))
	return nil
}
