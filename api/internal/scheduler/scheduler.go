package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/proactive"
	"github.com/kliuchnikovv/genie-api/internal/push"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
	"gorm.io/datatypes"
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

	// Fire scheduled daily briefs for users whose local clock has reached their
	// configured time.
	s.dispatchDailyBriefs(ctx)
}

// dispatchDailyBriefs fires a once-per-day "daily_brief" proactive event for
// each opted-in user whose local wall clock currently sits in the one-minute
// window starting at their configured DailyBriefTime. Idempotency is enforced
// by comparing DailyBriefLastSent's local date against today.
func (s *Scheduler) dispatchDailyBriefs(ctx context.Context) {
	users, err := s.storage.ListDailyBriefCandidates(ctx)
	if err != nil {
		s.logger.Error("scheduler: failed to list daily-brief candidates", zap.Error(err))
		return
	}

	now := time.Now()
	for _, u := range users {
		loc := time.UTC
		if u.Timezone != nil {
			if parsed, lerr := time.LoadLocation(*u.Timezone); lerr == nil {
				loc = parsed
			}
		}
		localNow := now.In(loc)

		targetH, targetM, ok := parseHHMM(*u.DailyBriefTime)
		if !ok {
			continue
		}

		// Minute-aligned match: fire when current local HH:MM equals the target.
		if localNow.Hour() != targetH || localNow.Minute() != targetM {
			continue
		}

		// Once per local day: skip if already sent today.
		if u.DailyBriefLastSent != nil {
			last := u.DailyBriefLastSent.In(loc)
			if last.Year() == localNow.Year() && last.YearDay() == localNow.YearDay() {
				continue
			}
		}

		payload := map[string]any{
			"local_date": localNow.Format("2006-01-02"),
			"timezone":   loc.String(),
		}
		payloadBytes, merr := json.Marshal(payload)
		if merr != nil {
			s.logger.Error("scheduler: marshal daily-brief payload", zap.Error(merr))
			continue
		}

		ev, cerr := s.storage.CreateProactiveEvent(ctx, &storage.ProactiveEvent{
			ID:        uuid.New(),
			UserID:    u.ID,
			Source:    "system",
			EventType: "daily_brief",
			Payload:   datatypes.JSON(payloadBytes),
			State:     "pending",
		})
		if cerr != nil {
			s.logger.Error("scheduler: create daily-brief event",
				zap.String("user_id", u.ID.String()), zap.Error(cerr))
			continue
		}

		if derr := s.dispatcher.Dispatch(ctx, ev); derr != nil {
			s.logger.Error("scheduler: dispatch daily-brief event",
				zap.String("user_id", u.ID.String()), zap.Error(derr))
			continue
		}

		if merr := s.storage.MarkDailyBriefSent(ctx, u.ID, now); merr != nil {
			s.logger.Error("scheduler: mark daily-brief sent",
				zap.String("user_id", u.ID.String()), zap.Error(merr))
		}
	}
}

// parseHHMM parses a "HH:MM" (or "HH:MM:SS") string into hour and minute.
func parseHHMM(s string) (hour, minute int, ok bool) {
	if _, err := fmt.Sscanf(s, "%d:%d", &hour, &minute); err != nil {
		return 0, 0, false
	}
	if hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return 0, 0, false
	}
	return hour, minute, true
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
