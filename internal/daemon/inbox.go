package daemon

import (
	"context"
	"time"

	"github.com/kliuchnikovv/genie-api/internal/integrations"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

type InboxDaemon struct {
	logger      *zap.Logger
	storage     *storage.Storage
	imapService *integrations.GmailIMAPService
}

func NewInboxDaemon(logger *zap.Logger, store *storage.Storage, imapService *integrations.GmailIMAPService) *InboxDaemon {
	return &InboxDaemon{
		logger:      logger.With(zap.String("component", "inbox_daemon")),
		storage:     store,
		imapService: imapService,
	}
}

func (d *InboxDaemon) Start(ctx context.Context) {
	d.logger.Info("starting inbox daemon")

	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			d.logger.Info("stopping inbox daemon")
			return
		case <-ticker.C:
			if err := d.imapService.ProcessPendingItems(ctx); err != nil {
				d.logger.Error("failed to process pending items", zap.Error(err))
			}
		}
	}
}
