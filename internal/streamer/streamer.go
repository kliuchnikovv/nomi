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
	chatID uuid.UUID

	connectModel func() (*websocket.Conn, error)
}

func New(
	storage *storage.Storage,
	logger *zap.Logger,
	userID uuid.UUID,
	chatID uuid.UUID,
	connectModel func() (*websocket.Conn, error),
) *Streamer {
	return &Streamer{
		storage:      storage,
		logger:       logger,
		userID:       userID,
		chatID:       chatID,
		connectModel: connectModel,
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
				streamer.logger.Debug("model chan is closed; will reconnect on next client message")
				return
			}

			resetTimer()
			if frame.Operation == MessageOperation && frame.Payload.Kind == TokenKind {
				if err := streamer.storage.UpsertMessage(ctx, streamer.userID, &chat.Message{
					ID:        frame.Payload.MessageID,
					ChatID:    streamer.chatID,
					Sender:    storage.ZeroUUID,
					Role:      chat.RoleAssistant,
					Text:      frame.Payload.Message,
					CreatedAt: time.Now().UTC(),
				}); err != nil {
					streamer.logger.Error("failed to upsert message", zap.Error(err))
				}
			}

			if clientAlive {
				if err := client.Write(ctx, frame); err != nil {
					streamer.logger.Error("failed to write to client", zap.Error(err))
					// Treat as client closed; stop writing to client, keep model.
					clientAlive = false
					clientFramesCh = nil
					clientErrsCh = nil
				}
			}
		case frame, ok := <-clientFramesCh:
			if !ok {
				if !clientAlive {
					continue
				}

				// Client closed — keep model alive until it finishes.
				streamer.logger.Debug("client chan is closed; keeping model alive")
				if err := modelReader.Write(ctx, Frame{
					Kind:      TokenKind,
					Operation: DoneOperation,
				}); err != nil {
					streamer.logger.Error("failed to write to model", zap.Error(err))
					_ = model.Close()
				}
				clientAlive = false
				continue
			}

			resetTimer()
			if frame.Operation == MessageOperation {
				if err := streamer.storage.UpsertMessage(ctx, streamer.userID, &chat.Message{
					ID:        uuid.New(),
					ChatID:    streamer.chatID,
					Sender:    streamer.userID,
					Role:      chat.RoleUser,
					Text:      frame.Payload.Message,
					CreatedAt: time.Now().UTC(),
				}); err != nil {
					streamer.logger.Error("failed to upsert message", zap.Error(err))
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
				}
			}
		case err, ok := <-modelErrsCh:
			if !ok {
				streamer.logger.Debug("model err chan is closed; will reconnect on demand")
				if model != nil {
					_ = model.Close()
					model = nil
				}
				modelErrsCh = nil
				continue
			}
			streamer.logger.Error("model err", zap.Error(err))
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

				streamer.logger.Debug("client err chan is closed; keeping model alive")
				if err := modelReader.Write(ctx, Frame{
					Kind:      TokenKind,
					Operation: DoneOperation,
				}); err != nil {
					streamer.logger.Error("failed to write to model", zap.Error(err))
					_ = model.Close()
				}
				clientAlive = false

				continue
			}

			streamer.logger.Error("client err", zap.Error(err))
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
