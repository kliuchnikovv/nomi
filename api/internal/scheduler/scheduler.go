package scheduler

import (
	"context"
	"encoding/json"
	"time"

	"github.com/kliuchnikovv/genie-api/internal/proactive"
	"github.com/kliuchnikovv/genie-api/internal/push"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type Scheduler struct {
	storage    *storage.Storage
	logger     *zap.Logger
	dispatcher *proactive.Dispatcher
	push       *push.Service
}

func New(store *storage.Storage, logger *zap.Logger, redisClient *redis.Client) *Scheduler {
	return &Scheduler{
		storage:    store,
		logger:     logger,
		dispatcher: proactive.NewDispatcher(store, redisClient, logger),
		push:       push.New(store, logger),
	}
}

func (s *Scheduler) Start(ctx context.Context) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.dispatch(ctx)
		}
	}
}

func (s *Scheduler) dispatch(ctx context.Context) {
	notifications, err := s.storage.ListPendingDue(ctx, time.Now())
	if err != nil {
		s.logger.Error("scheduler: failed to list pending notifications", zap.Error(err))
		return
	}

	for _, n := range notifications {
		s.send(ctx, n)
	}

	// Process due proactive events.
	events, err := s.storage.ListPendingDueEvents(ctx, 100)
	if err != nil {
		s.logger.Error("scheduler: failed to list pending proactive events", zap.Error(err))
		return
	}
	for _, ev := range events {
		if err := s.dispatcher.Dispatch(ctx, ev); err != nil {
			s.logger.Error("scheduler: failed to dispatch proactive event",
				zap.String("event_id", ev.ID.String()),
				zap.Error(err),
			)
		}
	}
}

func (s *Scheduler) send(ctx context.Context, n storage.Notification) {
	// Always mark fired to prevent re-delivery regardless of dispatch result
	defer func() {
		if err := s.storage.MarkFired(ctx, n.ID); err != nil {
			s.logger.Error("scheduler: failed to mark notification fired",
				zap.String("notification_id", n.ID.String()), zap.Error(err))
		}
	}()

	var data map[string]interface{}
	if len(n.DeepLink) > 0 {
		_ = json.Unmarshal(n.DeepLink, &data)
	}

	if err := s.push.SendToUser(ctx, n.UserID, push.Message{
		Title: n.Title,
		Body:  n.Body,
		Data:  map[string]interface{}{"deep_link": data},
	}); err != nil {
		s.logger.Error("scheduler: expo push failed",
			zap.String("notification_id", n.ID.String()),
			zap.Error(err))
	}
}
