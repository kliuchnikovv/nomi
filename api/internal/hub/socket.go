package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

type Socket struct {
	conn   *websocket.Conn
	lock   sync.Mutex
	logger *zap.Logger
}

func NewSocketReader(conn *websocket.Conn, logger *zap.Logger) *Socket {
	return &Socket{
		conn:   conn,
		logger: logger,
	}
}

func (s *Socket) Read(ctx context.Context) (<-chan Frame, <-chan error) {
	var (
		frames = make(chan Frame)
		errs   = make(chan error)
	)

	go func() {
		defer close(frames)
		defer close(errs)

		for {
			select {
			case <-ctx.Done():
				return
			default:
				_, msg, err := s.conn.ReadMessage()
				if err != nil {
					errs <- err
					return
				}

				var frame Frame
				if err := json.Unmarshal(msg, &frame); err != nil {
					s.logger.Warn("failed to unmarshal frame", zap.Error(err))
					continue
				}

				select {
				case <-ctx.Done():
					return
				case frames <- frame:
				}
			}
		}
	}()

	return frames, errs
}

func (s *Socket) Write(ctx context.Context, frame Frame) error {
	s.lock.Lock()
	defer s.lock.Unlock()

	if err := s.conn.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil {
		return fmt.Errorf("failed to set write deadline: %w", err)
	}

	if err := s.conn.WriteJSON(frame); err != nil {
		return fmt.Errorf("failed to write json: %w", err)
	}

	return nil
}

func (s *Socket) Close() error {
	return s.conn.Close()
}
