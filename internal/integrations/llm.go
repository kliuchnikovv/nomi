package integrations

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/kliuchnikovv/genie-api/internal/streamer"
	"go.uber.org/zap"
)

type LLMClient struct {
	logger  *zap.Logger
	url     *url.URL
	storage *storage.Storage
}

func NewLLMClient(logger *zap.Logger, cfg *config.Config, store *storage.Storage) (*LLMClient, error) {
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
		logger:  logger.With(zap.String("component", "llm_client")),
		url:     u,
		storage: store,
	}, nil
}

func (c *LLMClient) Generate(ctx context.Context, userID uuid.UUID, prompt string) (string, error) {
	// Add session_id to avoid "invalid session_id: None" error
	// For background processing (IMAP), we use a system session
	headers := http.Header{}
	headers.Add("Cookie", fmt.Sprintf("session_id=%s", "system-background-processing"))

	conn, _, err := websocket.DefaultDialer.Dial(c.url.String(), headers)
	if err != nil {
		return "", fmt.Errorf("failed to dial LLM: %w", err)
	}
	defer conn.Close()

	// Send tools to LLM first (same as in streamer)
	tools, err := c.storage.GetTools(ctx, userID)
	if err != nil {
		c.logger.Warn("failed to fetch tools for LLM", zap.Error(err))
	} else if len(tools) > 0 {
		// Convert tools to payload format
		toolsPayload := make([]map[string]interface{}, 0, len(tools))
		for _, tool := range tools {
			toolsPayload = append(toolsPayload, map[string]interface{}{
				"name":    tool.Name,
				"enabled": tool.Enabled,
				"params":  tool.Params,
			})
		}

		toolsFrame := streamer.Frame{
			Kind:      streamer.TokenKind,
			Operation: streamer.ToolsOperation,
			Timestamp: time.Now().UTC(),
			Payload: streamer.Payload{
				Tools: map[string]interface{}{
					"tools": toolsPayload,
				},
			},
		}

		if err := conn.WriteJSON(toolsFrame); err != nil {
			c.logger.Error("failed to send tools to LLM", zap.Error(err))
		} else {
			c.logger.Info("sent tools to LLM", zap.Int("count", len(tools)))
		}
	}

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
