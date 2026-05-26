package scheduler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/kliuchnikovv/genie-api/internal/proactive"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

const expoAPIURL = "https://exp.host/--/api/v2/push/send"

type Scheduler struct {
	storage    *storage.Storage
	httpClient *http.Client
	logger     *zap.Logger
	dispatcher *proactive.Dispatcher
}

type expoPushMessage struct {
	To       string                 `json:"to"`
	Title    string                 `json:"title"`
	Body     string                 `json:"body"`
	Sound    string                 `json:"sound"`
	Data     map[string]interface{} `json:"data,omitempty"`
	Priority string                 `json:"priority"`
}

type expoPushResponse struct {
	Data []struct {
		Status  string `json:"status"`
		Message string `json:"message,omitempty"`
		Details struct {
			Error string `json:"error,omitempty"`
		} `json:"details,omitempty"`
	} `json:"data"`
}

func New(store *storage.Storage, logger *zap.Logger, redisClient *redis.Client) *Scheduler {
	return &Scheduler{
		storage:    store,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		logger:     logger,
		dispatcher: proactive.NewDispatcher(store, redisClient, logger),
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

	tokens, err := s.storage.DeviceTokensForUser(ctx, n.UserID)
	if err != nil {
		s.logger.Error("scheduler: failed to get device tokens",
			zap.String("user_id", n.UserID.String()), zap.Error(err))
		return
	}
	if len(tokens) == 0 {
		return
	}

	var data map[string]interface{}
	if len(n.DeepLink) > 0 {
		_ = json.Unmarshal(n.DeepLink, &data)
	}

	messages := make([]expoPushMessage, 0, len(tokens))
	for _, token := range tokens {
		messages = append(messages, expoPushMessage{
			To:       token,
			Title:    n.Title,
			Body:     n.Body,
			Sound:    "default",
			Data:     map[string]interface{}{"deep_link": data},
			Priority: "high",
		})
	}

	if err := s.sendToExpo(ctx, messages); err != nil {
		s.logger.Error("scheduler: expo push failed",
			zap.String("notification_id", n.ID.String()),
			zap.Error(err))
	}
}

func (s *Scheduler) sendToExpo(ctx context.Context, messages []expoPushMessage) error {
	body, err := json.Marshal(messages)
	if err != nil {
		return fmt.Errorf("marshal expo payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, expoAPIURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("expo api request: %w", err)
	}
	defer resp.Body.Close()

	var result expoPushResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("decode expo response: %w", err)
	}

	for i, item := range result.Data {
		if item.Status == "error" {
			s.logger.Warn("scheduler: expo push ticket error",
				zap.Int("index", i),
				zap.String("message", item.Message),
				zap.String("error", item.Details.Error))
		}
	}
	return nil
}
