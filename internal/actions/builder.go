package actions

import (
	"fmt"
	"regexp"

	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

// Builder generates available actions for an email
type Builder struct {
	logger *zap.Logger
}

// NewBuilder creates a new action builder
func NewBuilder(logger *zap.Logger) *Builder {
	return &Builder{
		logger: logger.With(zap.String("component", "action_builder")),
	}
}

// BuildActions generates all available actions for an email
func (b *Builder) BuildActions(email *storage.Inbox) []storage.InboxAction {
	actions := []storage.InboxAction{}

	// 1. Open in Gmail (always available)
	if url := b.buildGmailURL(email); url != "" {
		actions = append(actions, storage.InboxAction{
			Label:   "Open in Gmail",
			Command: "open_web",
			Agent:   "mailer",
			URL:     &url,
		})
	}

	// 2. Unsubscribe (if link found)
	if url := b.findUnsubscribeURL(email.Body); url != "" {
		actions = append(actions, storage.InboxAction{
			Label:   "Unsubscribe",
			Command: "unsubscribe",
			Agent:   "mailer",
			URL:     &url,
		})
	}

	// 3. Mark as read (always available)
	actions = append(actions, storage.InboxAction{
		Label:   "Mark as read",
		Command: "mark_as_read",
		Agent:   "mailer",
	})

	// 4. Archive (always available)
	actions = append(actions, storage.InboxAction{
		Label:   "Archive",
		Command: "archive",
		Agent:   "mailer",
	})

	// 5. Reply (always available)
	prompt := fmt.Sprintf("Reply to email from %s about '%s'", email.Sender, email.Subject)
	actions = append(actions, storage.InboxAction{
		Label:   "Reply",
		Command: "reply",
		Agent:   "mailer",
		Prompt:  &prompt,
	})

	return actions
}

// buildGmailURL constructs the Gmail web URL from thread ID
func (b *Builder) buildGmailURL(email *storage.Inbox) string {
	if email.ThreadID > 0 {
		// Use mobile-compatible Gmail URL format
		return fmt.Sprintf("https://mail.google.com/mail/mu/mp/952/#cv/priority/%%5Esmartlabel_personal/%x", email.ThreadID)
	}
	return ""
}

// findUnsubscribeURL searches for unsubscribe link in email body
func (b *Builder) findUnsubscribeURL(body string) string {
	if body == "" {
		return ""
	}

	// Try multiple patterns - order matters, try most specific first
	patterns := []string{
		// Pattern 1: href="..." or href='...'
		`(?i)href\s*=\s*["']([^"']*unsubscribe[^"']*)["']`,
		// Pattern 2: Standalone URL with unsubscribe
		`(?i)(https?://[^\s<>"']+unsubscribe[^\s<>"']*)`,
		// Pattern 3: URL in angle brackets
		`(?i)<(https?://[^>]*unsubscribe[^>]*)>`,
	}

	for _, pattern := range patterns {
		re := regexp.MustCompile(pattern)
		if matches := re.FindStringSubmatch(body); len(matches) >= 2 {
			url := matches[1]
			// Clean up common artifacts
			url = regexp.MustCompile(`[<>]`).ReplaceAllString(url, "")
			b.logger.Debug("found unsubscribe URL", zap.String("url", url))
			return url
		}
	}

	return ""
}
