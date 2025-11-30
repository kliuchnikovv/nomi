package streamer

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

type Streamer struct {
	storage *storage.Storage
	logger  *zap.Logger

	userID uuid.UUID
	// chatID uuid.UUID

	source         string
	initialMessage string
	commandPayload interface{}
	chatHistory    []*chat.Message
	connectModel   func() (*websocket.Conn, error)
}

func New(
	storage *storage.Storage,
	logger *zap.Logger,
	userID uuid.UUID,
	initialMessage string,
	source string,
	commandPayload interface{},
	chatHistory []*chat.Message,
	connectModel func() (*websocket.Conn, error),
) *Streamer {
	return &Streamer{
		storage:        storage,
		logger:         logger,
		userID:         userID,
		initialMessage: initialMessage,
		source:         source,
		commandPayload: commandPayload,
		chatHistory:    chatHistory,
		connectModel:   connectModel,
	}
}

// TODO: should handle client closing - keep alive model connection until end of write
func (streamer *Streamer) Stream(
	client *Socket,
) {
	var ctx, cancel = context.WithCancel(context.Background())
	defer cancel()

	// Model connection (dialed now and on-demand later)
	var model *websocket.Conn
	var modelReader *Socket
	var modelFrames <-chan Frame
	var modelErrs <-chan error

	dialModel := func() bool {
		if streamer.connectModel == nil {
			streamer.logger.Error("connectModel is nil; cannot dial model")
			return false
		}
		conn, err := streamer.connectModel()
		if err != nil {
			streamer.logger.Error("failed to connect model", zap.Error(err))
			return false
		}
		model = conn
		modelReader = NewSocketReader(model, streamer.logger)
		modelFrames, modelErrs = modelReader.Read(ctx)
		return true
	}

	_ = dialModel()
	clientFrames, clientErrs := client.Read(ctx)

	// Send integrations to model immediately upon connection
	if modelReader != nil {
		tools, err := streamer.storage.GetIntegrations(ctx, streamer.userID)
		if err != nil {
			streamer.logger.Error("failed to fetch integrations for initial send", zap.Error(err))
		} else {
			// Convert integrations to response format
			toolsPayload := make([]map[string]interface{}, 0, len(tools))
			for _, integration := range tools {
				toolsPayload = append(toolsPayload, map[string]interface{}{
					"name":    integration.Name,
					"enabled": integration.Enabled,
					"params":  integration.Params,
				})
			}

			// Send integrations to model (AgnoProject) immediately
			toolsFrame := Frame{
				ID:        0,
				ChatID:    uuid.Nil,
				Kind:      TokenKind,
				Operation: ToolsOperation,
				Timestamp: time.Now().UTC(),
				Payload: Payload{
					Tools: func() map[string]interface{} {
						payload := map[string]interface{}{
							"tools": toolsPayload,
						}
						if streamer.commandPayload != nil {
							payload["command"] = streamer.commandPayload
							payload["team"] = streamer.commandPayload
						}
						return payload
					}(),
				},
			}
			if err := modelReader.Write(ctx, toolsFrame); err != nil {
				streamer.logger.Error("failed to send initial tools frame to model", zap.Error(err))
			} else {
				streamer.logger.Info("sent initial tools to model", zap.Int("count", len(tools)))
			}
		}

		// Send chat history to model if available
		if len(streamer.chatHistory) > 0 {
			// Format history as array of messages with role and content
			historyMessages := make([]map[string]interface{}, 0, len(streamer.chatHistory))
			for _, msg := range streamer.chatHistory {
				historyMessages = append(historyMessages, map[string]interface{}{
					"role":    string(msg.Role),
					"content": msg.Text,
				})
			}

			historyFrame := Frame{
				ID:        0,
				ChatID:    uuid.Nil,
				Kind:      TokenKind,
				Operation: HistoryOperation,
				Timestamp: time.Now().UTC(),
				Payload: Payload{
					History: map[string]interface{}{
						"messages": historyMessages,
					},
				},
			}
			if err := modelReader.Write(ctx, historyFrame); err != nil {
				streamer.logger.Error("failed to send history frame to model", zap.Error(err))
			} else {
				streamer.logger.Info("sent chat history to model", zap.Int("count", len(streamer.chatHistory)))
			}
		}

		// Send initial message if present
		if streamer.initialMessage != "" {
			msgFrame := Frame{
				Kind:      TokenKind,
				Operation: MessageOperation,
				Timestamp: time.Now().UTC(),
				Payload: Payload{
					Message: streamer.initialMessage,
				},
			}
			if err := modelReader.Write(ctx, msgFrame); err != nil {
				streamer.logger.Error("failed to send initial message to model", zap.Error(err))
			} else {
				streamer.logger.Info("sent initial message to model", zap.String("message", streamer.initialMessage))
			}
		}
	}

	// Make channels mutable so we can nil them out when their source closes.
	// This prevents select from immediately choosing a closed channel and
	// allows us to keep the connection alive until the client closes.
	modelFramesCh := modelFrames
	modelErrsCh := modelErrs
	clientFramesCh := clientFrames
	clientErrsCh := clientErrs

	// Idle timeout: close the stream if no activity for 5 minutes.
	const idleTimeout = 5 * time.Minute
	timer := time.NewTimer(idleTimeout)
	defer timer.Stop()

	resetTimer := func() {
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(idleTimeout)
	}

	// Track client state to keep model streaming after client disconnects.
	clientAlive := true

	for {
		select {
		case <-ctx.Done():
			streamer.logger.Debug("context is done")
			return
		case <-timer.C:
			streamer.logger.Info("idle timeout reached; terminating stream")
			return
		case frame, ok := <-modelFramesCh:
			if !ok {
				// Upstream (model) closed; mark model down and continue.
				streamer.logger.Info("model chan is closed; will reconnect on next client message")
				return
			}

			resetTimer()

			if frame.Operation == MessageOperation && frame.Kind == TokenKind {
				streamer.logger.Info("upserting message", zap.Any("frame", frame), zap.String("message_id", frame.Payload.MessageID.String()))
				if streamer.source == "inbox" {
					if err := streamer.storage.UpsertInboxMessage(ctx, streamer.userID, &storage.InboxMessage{
						ID:            frame.Payload.MessageID,
						IntegrationID: frame.ChatID,
						Role:          "assistant",
						Content:       frame.Payload.Message,
						Source:        streamer.source,
						Status:        "read",
					}); err != nil {
						streamer.logger.Error("failed to upsert inbox message", zap.Error(err))
					}
				} else {
					if err := streamer.storage.UpsertMessage(ctx, streamer.userID, &chat.Message{
						ID:        frame.Payload.MessageID,
						ChatID:    frame.ChatID,
						Sender:    storage.ZeroUUID,
						Role:      chat.RoleAssistant,
						Text:      frame.Payload.Message,
						CreatedAt: time.Now().UTC(),
					}); err != nil {
						streamer.logger.Error("failed to upsert message", zap.Error(err))
					}
				}
			}

			if clientAlive {
				if err := client.Write(ctx, frame); err != nil {
					streamer.logger.Error("failed to write to client", zap.Error(err))
					// Treat as client closed; stop writing to client, keep model.
					clientAlive = false
					clientFramesCh = nil
					clientErrsCh = nil
				} else {
					// streamer.logger.Debug("forwarded frame from model to client", zap.String("op", string(frame.Operation)))
				}
			}
		case frame, ok := <-clientFramesCh:
			if !ok {
				if !clientAlive {
					continue
				}

				// Client closed — keep model alive until it finishes.
				streamer.logger.Info("client chan is closed; keeping model alive")
				if err := modelReader.Write(ctx, Frame{
					Kind:      TokenKind,
					Operation: DoneOperation,
				}); err != nil {
					streamer.logger.Error("failed to write done to model", zap.Error(err))
					_ = model.Close()
				}
				clientAlive = false
				continue
			}

			resetTimer()
			streamer.logger.Info("received frame from client", zap.String("op", string(frame.Operation)))

			if frame.Operation == MessageOperation && frame.Payload.MessageID == storage.ZeroUUID {
				streamer.logger.Info("got frame to upsert", zap.Any("frame", frame), zap.String("message_id", frame.Payload.MessageID.String()))
				if streamer.source == "inbox" {
					if err := streamer.storage.UpsertInboxMessage(ctx, streamer.userID, &storage.InboxMessage{
						ID:            uuid.New(),
						IntegrationID: frame.ChatID,
						Role:          "user",
						Content:       frame.Payload.Message,
						Source:        streamer.source,
						Status:        "read",
					}); err != nil {
						streamer.logger.Error("failed to upsert inbox message", zap.Error(err))
					}
				} else {
					if err := streamer.storage.UpsertMessage(ctx, streamer.userID, &chat.Message{
						ID:        uuid.New(),
						ChatID:    frame.ChatID,
						Sender:    streamer.userID,
						Role:      chat.RoleUser,
						Text:      frame.Payload.Message,
						CreatedAt: time.Now().UTC(),
					}); err != nil {
						streamer.logger.Error("failed to upsert message", zap.Error(err))
					}
				}
			}

			// Ensure model is connected before forwarding client message.
			if model == nil {
				if !dialModel() {
					streamer.logger.Error("model not available; dropping client frame")
				}
			}
			if modelReader != nil && model != nil {
				if err := modelReader.Write(ctx, frame); err != nil {
					streamer.logger.Error("failed to write to model", zap.Error(err))
					_ = model.Close()
					return
				} else {
					streamer.logger.Info("forwarded frame from client to model", zap.String("op", string(frame.Operation)))
				}
			}
		case err, ok := <-modelErrsCh:
			if !ok {
				streamer.logger.Info("model err chan is closed; will reconnect on demand")
				if model != nil {
					_ = model.Close()
					model = nil
				}
				modelErrsCh = nil
				continue
			}
			streamer.logger.Error("model error received", zap.Error(err))
			// On model error, mark model down and continue.
			if model != nil {
				_ = model.Close()
				model = nil
			}
			modelFramesCh = nil
			modelErrsCh = nil
		case err, ok := <-clientErrsCh:
			if !ok {
				if !clientAlive {
					continue
				}

				streamer.logger.Info("client err chan is closed; keeping model alive")
				if err := modelReader.Write(ctx, Frame{
					Kind:      TokenKind,
					Operation: DoneOperation,
				}); err != nil {
					streamer.logger.Error("failed to write done to model", zap.Error(err))
					_ = model.Close()
				}
				clientAlive = false

				continue
			}

			streamer.logger.Error("client error received", zap.Error(err))
			// Treat client error as disconnect; stop client path, keep model.
			clientAlive = false
			clientFramesCh = nil
			clientErrsCh = nil
			// If model also gone, we can end.
			if modelFramesCh == nil && modelErrsCh == nil {
				return
			}
		}
	}
}
