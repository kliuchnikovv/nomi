package proactive

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/nomi-api/internal/storage"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// maxAutonomousPer24h caps how many autonomous (device-sourced) proactive
// events may be surfaced to a user in a rolling 24h window. User-explicit
// events (daily_brief, watch_reminder) are exempt. TODO(V2): make configurable.
const maxAutonomousPer24h = 20

// Dispatcher runs the decide-and-surface pipeline for a single ProactiveEvent.
type Dispatcher struct {
	store  *storage.Storage
	redis  *redis.Client
	logger *zap.Logger
}

// NewDispatcher constructs a Dispatcher.
func NewDispatcher(store *storage.Storage, redisClient *redis.Client, logger *zap.Logger) *Dispatcher {
	return &Dispatcher{
		store:  store,
		redis:  redisClient,
		logger: logger.With(zap.String("component", "proactive.dispatcher")),
	}
}

// Dispatch evaluates a ProactiveEvent and either rejects it, defers it (quiet hours),
// surfaces it to the updates chat via Redis, or routes it to the judge channel.
func (d *Dispatcher) Dispatch(ctx context.Context, ev *storage.ProactiveEvent) error {
	// 1. Load user.
	user, err := d.store.GetUserByID(ctx, ev.UserID)
	if err != nil {
		return fmt.Errorf("load user %s: %w", ev.UserID, err)
	}

	// 2. Proactive feature gate.
	if !user.ProactiveEnabled {
		return d.reject(ctx, ev, "proactive_disabled")
	}

	// 2a. User-explicit events (scheduled daily brief, agent-set watch reminder)
	// fire at a user-chosen time, so they bypass the rules engine, quiet-hours
	// deferral, and the autonomous rate cap — surface them directly.
	if ev.EventType == "daily_brief" || ev.EventType == "watch_reminder" {
		return d.surface(ctx, ev, user)
	}

	// 2b. Rate cap for autonomous (device-sourced) events — don't flood the user.
	if n, err := d.store.CountSurfacedEventsInWindow(ctx, user.ID, 24*time.Hour); err == nil {
		if n >= maxAutonomousPer24h {
			return d.reject(ctx, ev, "rate_capped")
		}
	} else {
		// Fail open: a count error must not block legitimate events.
		d.logger.Warn("rate-cap count failed; allowing event",
			zap.String("user_id", user.ID.String()), zap.Error(err))
	}

	// 3. Quiet-hours check — only defer events that have no explicit fire_at.
	if ev.FireAt == nil && InQuietHours(time.Now(), user.QuietHoursStart, user.QuietHoursEnd) {
		return d.defer_(ctx, ev, user)
	}

	// 4. Rules engine.
	var payloadMap map[string]any
	if err := json.Unmarshal(ev.Payload, &payloadMap); err != nil {
		return fmt.Errorf("unmarshal event payload: %w", err)
	}

	var result RuleResult
	switch ev.Source {
	case "calendar":
		result = EvaluateCalendar(payloadMap)
	case "email":
		// TODO(V2): load priority senders from DB per user.
		result = EvaluateEmail(payloadMap, nil)
	case "reminders":
		result = EvaluateReminder(payloadMap)
	case "health":
		result = EvaluateHealth(payloadMap)
	default:
		result = RuleResult{DecisionGray, fmt.Sprintf("unknown source %q", ev.Source)}
	}

	d.logger.Info("rules decision",
		zap.String("event_id", ev.ID.String()),
		zap.String("decision", string(result.Decision)),
		zap.String("reason", result.Reason),
	)

	switch result.Decision {
	case DecisionReject:
		return d.reject(ctx, ev, result.Reason)
	case DecisionAccept:
		return d.surface(ctx, ev, user)
	default: // gray
		return d.judge(ctx, ev, user)
	}
}

// reject marks the event as rules_rejected.
func (d *Dispatcher) reject(ctx context.Context, ev *storage.ProactiveEvent, reason string) error {
	return d.store.UpdateEventState(ctx, ev.ID, "rules_rejected", reason)
}

// defer_ sets fire_at to the end of the quiet-hours window so the scheduler retries.
func (d *Dispatcher) defer_(ctx context.Context, ev *storage.ProactiveEvent, user *storage.User) error {
	// Compute end of quiet-hours window (same logic as InQuietHours but returns time).
	// For V1 we use UTC wall-clock (see TODO in rules.go).
	fireAt := quietHoursEnd(time.Now(), user.QuietHoursEnd)
	d.logger.Info("deferring event until quiet hours end",
		zap.String("event_id", ev.ID.String()),
		zap.Time("fire_at", fireAt),
	)
	return d.store.SetEventFireAt(ctx, ev.ID, fireAt)
}

// surface publishes to chat:request:{updates_chat_id} so the Python brain processes it.
func (d *Dispatcher) surface(ctx context.Context, ev *storage.ProactiveEvent, user *storage.User) error {
	if user.UpdatesChatID == nil || *user.UpdatesChatID == uuid.Nil {
		// Provision the updates chat on the fly.
		chatID, err := d.store.EnsureUpdatesChat(ctx, user.ID)
		if err != nil {
			return fmt.Errorf("ensure updates chat: %w", err)
		}
		user.UpdatesChatID = &chatID
	}

	chatID := *user.UpdatesChatID

	// Build the inner proactive_event sub-object.
	proactiveEventPayload := map[string]any{
		"event_id":   ev.ID.String(),
		"event_type": ev.EventType,
		"payload":    json.RawMessage(ev.Payload),
	}

	// Build the frame payload — matches the structure Python's redis_session.py expects.
	innerPayload := map[string]any{
		"message":         "",
		"source":          "proactive",
		"user_id":         user.ID.String(),
		"history":         []any{},
		"proactive_event": proactiveEventPayload,
	}
	payloadBytes, err := json.Marshal(innerPayload)
	if err != nil {
		return fmt.Errorf("marshal inner payload: %w", err)
	}

	frame := map[string]any{
		"id":      0,
		"chat_id": chatID.String(),
		"kind":    "data",
		"op":      "message",
		"ts":      time.Now().UTC().Format(time.RFC3339),
		"payload": json.RawMessage(payloadBytes),
	}
	frameBytes, err := json.Marshal(frame)
	if err != nil {
		return fmt.Errorf("marshal frame: %w", err)
	}

	channel := fmt.Sprintf("chat:request:%s", chatID.String())
	d.logger.Info("publishing proactive event to redis",
		zap.String("channel", channel),
		zap.String("event_id", ev.ID.String()),
	)
	if err := d.redis.Publish(ctx, channel, frameBytes).Err(); err != nil {
		return fmt.Errorf("redis publish: %w", err)
	}

	return d.store.UpdateEventState(ctx, ev.ID, "surfaced", "")
}

// judge publishes to proactive:judge:{event_id} for the Python judge worker.
// The event state stays "pending"; decision_listener updates state once the
// judge worker publishes back on proactive:decision:{event_id}.
func (d *Dispatcher) judge(ctx context.Context, ev *storage.ProactiveEvent, user *storage.User) error {
	if user.UpdatesChatID == nil || *user.UpdatesChatID == uuid.Nil {
		chatID, err := d.store.EnsureUpdatesChat(ctx, user.ID)
		if err != nil {
			return fmt.Errorf("ensure updates chat: %w", err)
		}
		user.UpdatesChatID = &chatID
	}

	// Shape matches what back/src/proactive/judge_worker.py expects.
	judgePayload, err := json.Marshal(map[string]any{
		"event_id":        ev.ID.String(),
		"user_id":         ev.UserID.String(),
		"event_type":      ev.EventType,
		"source":          ev.Source,
		"payload":         json.RawMessage(ev.Payload),
		"updates_chat_id": user.UpdatesChatID.String(),
	})
	if err != nil {
		return fmt.Errorf("marshal event for judge: %w", err)
	}
	channel := fmt.Sprintf("proactive:judge:%s", ev.ID.String())
	d.logger.Info("routing event to judge channel",
		zap.String("channel", channel),
		zap.String("event_id", ev.ID.String()),
	)
	return d.redis.Publish(ctx, channel, judgePayload).Err()
}

// quietHoursEnd computes the next time the quiet-hours window ends relative to now.
// Returns now+1h as a safe fallback when the end string is unparseable.
func quietHoursEnd(now time.Time, endStr *string) time.Time {
	if endStr == nil {
		return now.Add(time.Hour)
	}
	h, m, s := 0, 0, 0
	fmt.Sscanf(*endStr, "%d:%d:%d", &h, &m, &s)
	candidate := time.Date(now.Year(), now.Month(), now.Day(), h, m, s, 0, time.UTC)
	if !candidate.After(now) {
		candidate = candidate.Add(24 * time.Hour)
	}
	return candidate
}
