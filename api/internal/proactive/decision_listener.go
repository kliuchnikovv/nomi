package proactive

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// DecisionListener subscribes to proactive:decision:* and updates the
// corresponding ProactiveEvent row based on the judge worker's decision.
type DecisionListener struct {
	store  *storage.Storage
	redis  *redis.Client
	logger *zap.Logger
}

func NewDecisionListener(store *storage.Storage, redisClient *redis.Client, logger *zap.Logger) *DecisionListener {
	return &DecisionListener{
		store:  store,
		redis:  redisClient,
		logger: logger.With(zap.String("component", "proactive.decision_listener")),
	}
}

type decisionPayload struct {
	Decision string `json:"decision"`
	Reason   string `json:"reason"`
}

// Start blocks until ctx is cancelled.
func (l *DecisionListener) Start(ctx context.Context) error {
	pubsub := l.redis.PSubscribe(ctx, "proactive:decision:*")
	defer pubsub.Close()

	ch := pubsub.Channel()
	l.logger.Info("decision listener started")
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

func (l *DecisionListener) handle(ctx context.Context, channel, payload string) {
	const prefix = "proactive:decision:"
	if len(channel) <= len(prefix) {
		l.logger.Warn("malformed decision channel", zap.String("channel", channel))
		return
	}
	eventID, err := uuid.Parse(channel[len(prefix):])
	if err != nil {
		l.logger.Warn("invalid event id in channel", zap.String("channel", channel))
		return
	}

	var d decisionPayload
	if err := json.Unmarshal([]byte(payload), &d); err != nil {
		l.logger.Warn("invalid decision payload", zap.Error(err), zap.String("raw", payload))
		return
	}

	var state string
	switch d.Decision {
	case "surface":
		state = "surfaced"
	case "skip":
		state = "judge_rejected"
	default:
		l.logger.Warn("unknown decision value", zap.String("decision", d.Decision))
		return
	}

	if err := l.store.UpdateEventState(ctx, eventID, state, d.Reason); err != nil {
		l.logger.Error("update event state failed",
			zap.String("event_id", eventID.String()),
			zap.String("state", state),
			zap.Error(err),
		)
		return
	}

	l.logger.Info("applied judge decision",
		zap.String("event_id", eventID.String()),
		zap.String("state", state),
	)
}
