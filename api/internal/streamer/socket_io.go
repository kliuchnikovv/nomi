package streamer

import (
	"context"
	"encoding/json"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

type Conn interface {
	ReadMessage() (messageType int, p []byte, err error)
	WriteMessage(messageType int, data []byte) error
}

type Socket struct {
	conn   Conn
	logger *zap.Logger
}

func truncate(s string, limit int) string {
	if len(s) <= limit {
		return s
	}
	return s[:limit] + "...(truncated)"
}

func NewSocketReader(
	conn Conn,
	logger *zap.Logger,
) *Socket {
	return &Socket{
		conn: conn,
		logger: logger.With(
			zap.String("handler", "reader"),
		),
	}
}

func (reader *Socket) Read(
	ctx context.Context,
) (<-chan Frame, <-chan error) {
	var (
		frames = make(chan Frame, 1)
		errs   = make(chan error, 1)
	)

	go reader.read(
		ctx,
		reader.logger,
		frames,
		errs,
	)

	return frames, errs
}

func (reader *Socket) Write(
	ctx context.Context,
	frame Frame,
) error {
	msgPreview := ""
	if frame.Payload.Message != "" {
		msgPreview = truncate(frame.Payload.Message, 160)
	}
	reader.logger.Info("ws write",
		zap.String("op", string(frame.Operation)),
		zap.String("kind", string(frame.Kind)),
		zap.String("chat_id", frame.ChatID.String()),
		zap.String("message_preview", msgPreview),
	)

	b, err := json.Marshal(frame)
	if err != nil {
		return err
	}

	return reader.conn.WriteMessage(websocket.TextMessage, b)

}

func (reader *Socket) read(
	ctx context.Context,
	logger *zap.Logger,
	frames chan Frame,
	errs chan error,
) {
	defer close(frames)
	defer close(errs)

	for {
		select {
		case <-ctx.Done():
			return
		default:
			_, msg, err := reader.conn.ReadMessage()
			if err != nil {
				if websocket.IsCloseError(err, 1000) {
					logger.Info("got close message from client - finishing")
				} else {
					errs <- err
				}

				return
			}

			var frame Frame
			if err := json.Unmarshal(msg, &frame); err != nil {
				errs <- err
				return
			}

			frames <- frame
		}
	}
}
