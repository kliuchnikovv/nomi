package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/sideshow/apns2"
	"go.uber.org/zap"
)

type Scheduler struct {
	storage    *storage.Storage
	apns       *apns2.Client
	bundleID   string
	logger     *zap.Logger
	configured bool
}

type apnsPayload struct {
	APS      apnsAPS                `json:"aps"`
	DeepLink map[string]interface{} `json:"deep_link,omitempty"`
}

type apnsAPS struct {
	Alert apnsAlert `json:"alert"`
	Sound string    `json:"sound"`
}

type apnsAlert struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

func New(store *storage.Storage, logger *zap.Logger) *Scheduler {
	cfg := APNSConfigFromEnv()
	s := &Scheduler{
		storage:    store,
		logger:     logger,
		bundleID:   cfg.BundleID,
		configured: cfg.IsConfigured(),
	}

	if cfg.IsConfigured() {
		client, err := newAPNSClient(cfg)
		if err != nil {
			logger.Warn("failed to init APNs client, push notifications disabled", zap.Error(err))
		} else {
			s.apns = client
		}
	} else {
		logger.Info("APNs not configured (APNS_KEY_PATH/KEY_ID/TEAM_ID/BUNDLE_ID missing), push notifications disabled")
	}

	return s
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
}

func (s *Scheduler) send(ctx context.Context, n storage.Notification) {
	// Always mark fired to prevent re-delivery regardless of dispatch result
	defer func() {
		if err := s.storage.MarkFired(ctx, n.ID); err != nil {
			s.logger.Error("scheduler: failed to mark notification fired",
				zap.String("notification_id", n.ID.String()), zap.Error(err))
		}
	}()

	if s.apns == nil {
		s.logger.Debug("scheduler: APNs not configured, skipping push",
			zap.String("notification_id", n.ID.String()))
		return
	}

	tokens, err := s.storage.DeviceTokensForUser(ctx, n.UserID)
	if err != nil {
		s.logger.Error("scheduler: failed to get device tokens",
			zap.String("user_id", n.UserID.String()), zap.Error(err))
		return
	}

	payload, err := buildPayload(n)
	if err != nil {
		s.logger.Error("scheduler: failed to build payload", zap.Error(err))
		return
	}

	for _, token := range tokens {
		s.pushToDevice(n.ID, token, payload)
	}
}

func (s *Scheduler) pushToDevice(notifID uuid.UUID, deviceToken string, payload []byte) {
	notification := &apns2.Notification{
		DeviceToken: deviceToken,
		Topic:       s.bundleID,
		Payload:     payload,
		PushType:    apns2.PushTypeAlert,
	}

	resp, err := s.apns.Push(notification)
	if err != nil {
		s.logger.Error("scheduler: APNs push failed",
			zap.String("notification_id", notifID.String()),
			zap.Error(err))
		return
	}
	if resp.StatusCode != 200 {
		s.logger.Warn("scheduler: APNs rejected push",
			zap.String("notification_id", notifID.String()),
			zap.Int("status", resp.StatusCode),
			zap.String("reason", resp.Reason))
	}
}

func buildPayload(n storage.Notification) ([]byte, error) {
	p := apnsPayload{
		APS: apnsAPS{
			Alert: apnsAlert{Title: n.Title, Body: n.Body},
			Sound: "default",
		},
	}

	if len(n.DeepLink) > 0 {
		var dl map[string]interface{}
		if err := json.Unmarshal(n.DeepLink, &dl); err == nil {
			p.DeepLink = dl
		}
	}

	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal apns payload: %w", err)
	}
	return b, nil
}
