package actions

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

// Executor executes email actions
type Executor struct {
	logger       *zap.Logger
	storage      *storage.Storage
	gmailService GmailService
}

// GmailService interface for IMAP operations
type GmailService interface {
	MarkMessagesAsRead(ctx context.Context, userID uuid.UUID, uids []uint32) error
}

// NewExecutor creates a new action executor
func NewExecutor(logger *zap.Logger, store *storage.Storage, gmailSvc GmailService) *Executor {
	return &Executor{
		logger:       logger.With(zap.String("component", "action_executor")),
		storage:      store,
		gmailService: gmailSvc,
	}
}

// Execute runs the specified action
func (e *Executor) Execute(ctx context.Context, userID uuid.UUID, emailID uuid.UUID, action storage.InboxAction) error {
	e.logger.Info("executing action",
		zap.String("command", action.Command),
		zap.String("email_id", emailID.String()),
		zap.String("user_id", userID.String()))

	switch action.Command {
	case "mark_as_read":
		return e.markAsRead(ctx, userID, emailID)
	case "archive":
		return e.archive(ctx, userID, emailID)
	case "unsubscribe":
		return e.unsubscribe(ctx, action.URL)
	case "open_web":
		// Frontend handles this - no backend action needed
		return nil
	case "reply", "forward", "create_task", "add_to_calendar", "save_attachment", "custom":
		// LLM-suggested actions with prompts
		// These would trigger LLM or other services to execute
		// For now, just log them
		if action.Prompt != nil {
			e.logger.Info("LLM action triggered",
				zap.String("command", action.Command),
				zap.String("prompt", *action.Prompt))
		} else {
			e.logger.Warn("LLM action without prompt",
				zap.String("command", action.Command))
		}
		return nil
	default:
		return fmt.Errorf("unknown action command: %s", action.Command)
	}
}

// markAsRead marks the email as read both in DB and in Gmail via IMAP
func (e *Executor) markAsRead(ctx context.Context, userID uuid.UUID, emailID uuid.UUID) error {
	// 1. Mark as read in local database
	if err := e.storage.MarkAsRead(ctx, userID, emailID); err != nil {
		return fmt.Errorf("failed to mark as read in database: %w", err)
	}

	// 2. Get email UID to mark as read in Gmail
	var inbox storage.Inbox
	if err := e.storage.DB.WithContext(ctx).
		Where("id = ? AND user_id = ?", emailID, userID).
		First(&inbox).Error; err != nil {
		e.logger.Warn("failed to get email UID for IMAP mark as read", zap.Error(err))
		// Don't fail the whole operation if we can't mark in Gmail
		return nil
	}

	// 3. Mark as read in Gmail via IMAP
	if inbox.UID > 0 {
		if err := e.gmailService.MarkMessagesAsRead(ctx, userID, []uint32{inbox.UID}); err != nil {
			e.logger.Error("failed to mark as read in Gmail",
				zap.Error(err),
				zap.Uint32("uid", inbox.UID))
			// Don't fail - we already marked in DB
		} else {
			e.logger.Info("marked as read in Gmail",
				zap.Uint32("uid", inbox.UID),
				zap.String("subject", inbox.Subject))
		}
	}

	return nil
}

// archive archives the email (marks as archived)
func (e *Executor) archive(ctx context.Context, userID uuid.UUID, emailID uuid.UUID) error {
	result := e.storage.DB.WithContext(ctx).
		Model(&storage.Inbox{}).
		Where("id = ? AND user_id = ?", emailID, userID).
		Update("status", "archived")

	if result.Error != nil {
		return fmt.Errorf("failed to archive email: %w", result.Error)
	}

	if result.RowsAffected == 0 {
		return fmt.Errorf("email not found or already archived")
	}

	return nil
}

// unsubscribe opens the unsubscribe URL
func (e *Executor) unsubscribe(ctx context.Context, url *string) error {
	if url == nil || *url == "" {
		return fmt.Errorf("unsubscribe URL not provided")
	}

	// In a real implementation, you might:
	// 1. Make an HTTP request to the unsubscribe URL
	// 2. Parse the response
	// 3. Handle confirmation pages
	// For now, we just log it - the frontend will open the URL
	e.logger.Info("unsubscribe URL", zap.String("url", *url))
	return nil
}
