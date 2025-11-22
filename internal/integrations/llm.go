package integrations

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/streamer"
	"go.uber.org/zap"
)

type LLMClient struct {
	logger *zap.Logger
	url    *url.URL
}

func NewLLMClient(logger *zap.Logger, cfg *config.Config) (*LLMClient, error) {
	if cfg.LLM.BaseURL == "" {
		return nil, fmt.Errorf("LLM base URL is not configured")
	}

	u, err := url.Parse(cfg.LLM.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("invalid LLM base URL: %w", err)
	}

	switch u.Scheme {
	case "http":
		u.Scheme = "ws"
	case "https":
		u.Scheme = "wss"
	}
	u.Path, err = url.JoinPath(u.Path, "/llm/ws")
	if err != nil {
		return nil, fmt.Errorf("failed to join path: %w", err)
	}

	return &LLMClient{
		logger: logger.With(zap.String("component", "llm_client")),
		url:    u,
	}, nil
}

func (c *LLMClient) Generate(ctx context.Context, prompt string) (string, error) {
	conn, _, err := websocket.DefaultDialer.Dial(c.url.String(), http.Header{})
	if err != nil {
		return "", fmt.Errorf("failed to dial LLM: %w", err)
	}
	defer conn.Close()

	// Send message
	frame := streamer.Frame{
		Kind:      streamer.TokenKind,
		Operation: streamer.MessageOperation,
		Payload: streamer.Payload{
			Message: prompt,
		},
		Timestamp: time.Now().UTC(),
	}

	if err := conn.WriteJSON(frame); err != nil {
		return "", fmt.Errorf("failed to write message: %w", err)
	}

	// Read response
	var response string
	for {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		default:
			var msg streamer.Frame
			if err := conn.ReadJSON(&msg); err != nil {
				return "", fmt.Errorf("failed to read message: %w", err)
			}

			if msg.Operation == streamer.DoneOperation {
				return response, nil
			}

			if msg.Kind == streamer.TokenKind && msg.Operation == streamer.MessageOperation {
				response += msg.Payload.Message
			}
		}
	}
}
