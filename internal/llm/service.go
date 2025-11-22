package llm

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

type Service struct {
	logger  *zap.Logger
	url     *url.URL
	storage *storage.Storage
}

func NewService(logger *zap.Logger, cfg *config.Config, store *storage.Storage) (*Service, error) {
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

	return &Service{
		logger:  logger.With(zap.String("component", "llm_service")),
		url:     u,
		storage: store,
	}, nil
}

// GenerateSimple sends a prompt to LLM and returns the full response.
// Used for background processing like IMAP.
func (s *Service) GenerateSimple(ctx context.Context, userID uuid.UUID, prompt string) (string, error) {
	conn, err := s.connect(ctx, userID)
	if err != nil {
		return "", err
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

// StreamChunk represents a chunk of streaming response
type StreamChunk struct {
	Delta string
	Done  bool
}

// GenerateStream sends a prompt to LLM and returns a channel for streaming response.
// Used for chat.
func (s *Service) GenerateStream(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, prompt string) (<-chan StreamChunk, <-chan error) {
	chunks := make(chan StreamChunk)
	errs := make(chan error, 1)

	go func() {
		defer close(chunks)
		defer close(errs)

		conn, err := s.connect(ctx, userID)
		if err != nil {
			errs <- err
			return
		}
		defer conn.Close()

		// Send message
		frame := streamer.Frame{
			ChatID:    chatID,
			Kind:      streamer.TokenKind,
			Operation: streamer.MessageOperation,
			Payload: streamer.Payload{
				Message: prompt,
			},
			Timestamp: time.Now().UTC(),
		}

		if err := conn.WriteJSON(frame); err != nil {
			errs <- fmt.Errorf("failed to write message: %w", err)
			return
		}

		// Stream response
		for {
			select {
			case <-ctx.Done():
				errs <- ctx.Err()
				return
			default:
				var msg streamer.Frame
				if err := conn.ReadJSON(&msg); err != nil {
					errs <- fmt.Errorf("failed to read message: %w", err)
					return
				}

				if msg.Operation == streamer.DoneOperation {
					chunks <- StreamChunk{Done: true}
					return
				}

				if msg.Kind == streamer.TokenKind && msg.Operation == streamer.MessageOperation {
					chunks <- StreamChunk{Delta: msg.Payload.Message}
				}
			}
		}
	}()

	return chunks, errs
}

// connect establishes WebSocket connection and sends tools
func (s *Service) connect(ctx context.Context, userID uuid.UUID) (*websocket.Conn, error) {
	// Add session_id to avoid "invalid session_id: None" error
	headers := http.Header{}
	headers.Add("Cookie", fmt.Sprintf("session_id=%s", "system-background-processing"))

	conn, _, err := websocket.DefaultDialer.Dial(s.url.String(), headers)
	if err != nil {
		return nil, fmt.Errorf("failed to dial LLM: %w", err)
	}

	// Send tools first
	tools, err := s.storage.GetTools(ctx, userID)
	if err != nil {
		s.logger.Warn("failed to fetch tools for LLM", zap.Error(err))
	} else if len(tools) > 0 {
		if err := s.sendTools(conn, tools); err != nil {
			conn.Close()
			return nil, err
		}
	}

	return conn, nil
}

// sendTools sends tools frame to LLM
func (s *Service) sendTools(conn *websocket.Conn, tools []storage.Tool) error {
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
		return fmt.Errorf("failed to send tools to LLM: %w", err)
	}

	s.logger.Info("sent tools to LLM", zap.Int("count", len(tools)))
	return nil
}
