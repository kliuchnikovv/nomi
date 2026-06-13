// Package agenttask persists long-running agent-task state emitted by the
// Python runner. The runner is the brain (it decides and streams); the Go API
// is the single writer of the agent_tasks / agent_task_events tables.
package agenttask

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// channelPrefix is the Redis pub/sub prefix the runner publishes task lifecycle
// messages on, keyed by task id: agent:task:event:<task_id>.
const channelPrefix = "agent:task:event:"

// Listener subscribes to agent:task:event:* and upserts the AgentTask row plus
// appends AgentTaskEvent rows as the runner reports progress.
type Listener struct {
	store  *storage.Storage
	redis  *redis.Client
	logger *zap.Logger
}

func NewListener(store *storage.Storage, redisClient *redis.Client, logger *zap.Logger) *Listener {
	return &Listener{
		store:  store,
		redis:  redisClient,
		logger: logger.With(zap.String("component", "agenttask.listener")),
	}
}

// eventEnvelope is the message the Python runner publishes. Task fields update
// the AgentTask row; the optional event is appended to the log.
type eventEnvelope struct {
	UserID   string           `json:"user_id"`
	ChatID   string           `json:"chat_id"`
	Goal     string           `json:"goal"`
	Status   string           `json:"status"`
	Plan     *json.RawMessage `json:"plan"`     // present only when the plan changes
	Result   *string          `json:"result"`   // present on completion
	Finished bool             `json:"finished"` // true on done/failed/cancelled
	Event    *struct {
		Seq     int             `json:"seq"`
		Kind    string          `json:"kind"`
		Payload json.RawMessage `json:"payload"`
	} `json:"event"`
}

// Start blocks until ctx is cancelled.
func (l *Listener) Start(ctx context.Context) error {
	pubsub := l.redis.PSubscribe(ctx, channelPrefix+"*")
	defer pubsub.Close()

	ch := pubsub.Channel()
	l.logger.Info("agent task listener started")
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg, ok := <-ch:
			if !ok {
				return fmt.Errorf("pubsub channel closed")
			}
			l.handle(ctx, msg.Channel, msg.Payload)
		}
	}
}

func (l *Listener) handle(ctx context.Context, channel, payload string) {
	if len(channel) <= len(channelPrefix) {
		l.logger.Warn("malformed task channel", zap.String("channel", channel))
		return
	}
	taskID, err := uuid.Parse(channel[len(channelPrefix):])
	if err != nil {
		l.logger.Warn("invalid task id in channel", zap.String("channel", channel))
		return
	}

	var e eventEnvelope
	if err := json.Unmarshal([]byte(payload), &e); err != nil {
		l.logger.Warn("invalid task event payload", zap.Error(err), zap.String("raw", payload))
		return
	}

	if err := l.persistTask(ctx, taskID, &e); err != nil {
		l.logger.Error("persist task failed", zap.String("task_id", taskID.String()), zap.Error(err))
		return
	}

	if e.Event != nil {
		evt := &storage.AgentTaskEvent{
			TaskID:  taskID,
			Seq:     e.Event.Seq,
			Kind:    e.Event.Kind,
			Payload: datatypes.JSON(e.Event.Payload),
		}
		if err := l.store.AppendAgentTaskEvent(ctx, evt); err != nil {
			l.logger.Error("append task event failed",
				zap.String("task_id", taskID.String()),
				zap.Int("seq", e.Event.Seq),
				zap.Error(err),
			)
		}
	}
}

// persistTask creates the task on first sight, otherwise applies the mutable
// fields present in the message.
func (l *Listener) persistTask(ctx context.Context, taskID uuid.UUID, e *eventEnvelope) error {
	_, err := l.store.GetAgentTaskByID(ctx, taskID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return l.createTask(ctx, taskID, e)
	}
	if err != nil {
		return err
	}

	updates := map[string]interface{}{}
	if e.Status != "" {
		updates["status"] = e.Status
	}
	if e.Plan != nil {
		updates["plan"] = datatypes.JSON(*e.Plan)
	}
	if e.Result != nil {
		updates["result"] = *e.Result
	}
	if e.Finished {
		now := time.Now()
		updates["finished_at"] = now
	}
	if len(updates) == 0 {
		return nil
	}
	return l.store.UpdateAgentTask(ctx, taskID, updates)
}

func (l *Listener) createTask(ctx context.Context, taskID uuid.UUID, e *eventEnvelope) error {
	userID, err := uuid.Parse(e.UserID)
	if err != nil {
		return fmt.Errorf("invalid user_id %q: %w", e.UserID, err)
	}
	chatID, err := uuid.Parse(e.ChatID)
	if err != nil {
		return fmt.Errorf("invalid chat_id %q: %w", e.ChatID, err)
	}

	task := &storage.AgentTask{
		ID:     taskID,
		UserID: userID,
		ChatID: chatID,
		Goal:   e.Goal,
		Status: firstNonEmpty(e.Status, "planning"),
	}
	if e.Plan != nil {
		task.Plan = datatypes.JSON(*e.Plan)
	}
	if e.Result != nil {
		task.Result = *e.Result
	}
	return l.store.CreateAgentTask(ctx, task)
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
