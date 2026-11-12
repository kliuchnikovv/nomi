// Package push provides on-demand delivery of Expo push notifications,
// including silent (content-available) pushes used to wake the mobile app in
// the background so it can execute client-only tools.
package push

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/nomi-api/internal/storage"
	"go.uber.org/zap"
)

const expoAPIURL = "https://exp.host/--/api/v2/push/send"

// WakeActionType is the data.type value carried by a silent wake push. The
// mobile app inspects this to know it should connect its user-channel listener
// and drain any pending client actions.
const WakeActionType = "client_action_wake"

// ExpoMessage is a single Expo push payload. Title/Body/Sound are omitempty so
// silent pushes (ContentAvailable=true, no alert) can be sent for background
// wake-ups without showing anything to the user.
type ExpoMessage struct {
	To               string                 `json:"to"`
	Title            string                 `json:"title,omitempty"`
	Body             string                 `json:"body,omitempty"`
	Sound            string                 `json:"sound,omitempty"`
	Data             map[string]interface{} `json:"data,omitempty"`
	Priority         string                 `json:"priority,omitempty"`
	ContentAvailable bool                   `json:"_contentAvailable,omitempty"`
}

type expoResponse struct {
	Data []struct {
		Status  string `json:"status"`
		Message string `json:"message,omitempty"`
		Details struct {
			Error string `json:"error,omitempty"`
		} `json:"details,omitempty"`
	} `json:"data"`
}

// Message is a high-level notification request resolved to a user's devices.
type Message struct {
	Title  string
	Body   string
	Data   map[string]interface{}
	Silent bool // true → background wake (no alert), sets _contentAvailable
}

// Service sends Expo push notifications on demand.
type Service struct {
	store      *storage.Storage
	httpClient *http.Client
	logger     *zap.Logger
}

func New(store *storage.Storage, logger *zap.Logger) *Service {
	return &Service{
		store:      store,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		logger:     logger,
	}
}

// SendToUser resolves the user's registered devices and delivers msg to each.
// No-op (nil error) if the user has no registered devices.
func (s *Service) SendToUser(ctx context.Context, userID uuid.UUID, msg Message) error {
	tokens, err := s.store.DeviceTokensForUser(ctx, userID)
	if err != nil {
		return fmt.Errorf("get device tokens: %w", err)
	}
	if len(tokens) == 0 {
		return nil
	}

	messages := make([]ExpoMessage, 0, len(tokens))
	for _, token := range tokens {
		m := ExpoMessage{To: token, Data: msg.Data, Priority: "high"}
		if msg.Silent {
			m.ContentAvailable = true
		} else {
			m.Title = msg.Title
			m.Body = msg.Body
			m.Sound = "default"
		}
		messages = append(messages, m)
	}
	return s.SendRaw(ctx, messages)
}

// WakeDevice sends a silent push instructing the device to connect and drain
// any pending client actions. Used when the brain needs to reach a device that
// is not currently holding a user-channel WebSocket.
func (s *Service) WakeDevice(ctx context.Context, userID uuid.UUID) error {
	return s.SendToUser(ctx, userID, Message{
		Silent: true,
		Data:   map[string]interface{}{"type": WakeActionType},
	})
}

// SendRaw delivers pre-built Expo messages. Exposed for callers (e.g. the
// scheduler) that build their own message shape.
func (s *Service) SendRaw(ctx context.Context, messages []ExpoMessage) error {
	if len(messages) == 0 {
		return nil
	}
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

	var result expoResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("decode expo response: %w", err)
	}
	for i, item := range result.Data {
		if item.Status == "error" {
			s.logger.Warn("expo push ticket error",
				zap.Int("index", i),
				zap.String("message", item.Message),
				zap.String("error", item.Details.Error))
		}
	}
	return nil
}
