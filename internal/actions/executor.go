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
	logger  *zap.Logger
	storage *storage.Storage
}

// NewExecutor creates a new action executor
func NewExecutor(logger *zap.Logger, store *storage.Storage) *Executor {
	return &Executor{
		logger:  logger.With(zap.String("component", "action_executor")),
		storage: store,
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

// markAsRead marks the email as read
func (e *Executor) markAsRead(ctx context.Context, userID uuid.UUID, emailID uuid.UUID) error {
	return e.storage.MarkAsRead(ctx, userID, emailID)
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
