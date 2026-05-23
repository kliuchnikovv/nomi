package hub

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

type RoomType string

const (
	RoomTypeChat RoomType = "chat"
	RoomTypeUser RoomType = "user"
)

type replayEntry struct {
	seq   int
	msgID uuid.UUID
	data  []byte
}

const maxReplayBuf = 1000

type Room struct {
	ID     uuid.UUID
	Type   RoomType
	hub    *Hub
	logger *zap.Logger
	store  *storage.Storage

	// The user who initiated the session (for context/integrations)
	initiatorID uuid.UUID

	clients    map[*Client]bool
	ingress    chan *ClientMessage
	broadcast  chan Frame
	register   chan *Client
	unregister chan *Client

	// Ingress for LLM frames from Redis/worker
	llmIngress chan Frame

	// Replay buffer: frames accumulated during active generation for reconnecting clients
	replayBuf []replayEntry
	replayMu  sync.RWMutex
	replaySeq int

	// Team Mode
	mode string // "agent" or "team"

	command string // JSON-encoded team command

	// Generation state - prevents room from closing while LLM is generating
	generationInProgress bool
	generationTimer      *time.Timer
	generationTimeoutCh  chan struct{}

	// Model for current generation (set when forwarding user message to Redis)
	currentModelID string

	// Message builders state (replacing currentMessageMetadata)
	messageBuilders map[uuid.UUID]*MessageBuilder

	// User timezone (e.g., "Europe/Moscow", "America/New_York")
	timezone string
}

func NewRoom(hub *Hub, id uuid.UUID, roomType RoomType, initiatorID uuid.UUID, store *storage.Storage, logger *zap.Logger, llmBaseURL string, mode string, command string, timezone string) *Room {
	return &Room{
		ID:                  id,
		Type:                roomType,
		hub:                 hub,
		logger:              logger.With(zap.String("room_id", id.String()), zap.String("type", string(roomType))),
		store:               store,
		initiatorID:         initiatorID,
		clients:             make(map[*Client]bool),
		ingress:             make(chan *ClientMessage, 32),
		broadcast:           make(chan Frame, 64),
		register:            make(chan *Client),
		unregister:          make(chan *Client),
		llmIngress:          make(chan Frame, 64),
		mode:                mode,
		command:             command,
		messageBuilders:     make(map[uuid.UUID]*MessageBuilder),
		generationTimeoutCh: make(chan struct{}, 1),
		timezone:            timezone,
	}
}

func (r *Room) Run() {
	defer func() {
	}()

	// Idle timeout: close the room if no activity/clients for 5 minutes.
	const idleTimeout = 5 * time.Minute
	// Generation timeout: force stop generation if it takes too long
	const generationTimeout = 10 * time.Minute

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

	for {
		select {
		case client := <-r.register:
			// One client per user per room: evict existing connection for the same user.
			for c := range r.clients {
				if c.userID == client.userID {
					delete(r.clients, c)
					close(c.send)
					r.logger.Info("evicted previous client for same user", zap.String("user_id", c.userID.String()))
				}
			}
			r.clients[client] = true
			r.logger.Info("client joined room", zap.String("user_id", client.userID.String()))
			// Replay buffered frames if generation is in progress (client reconnected mid-stream).
			if r.generationInProgress {
				r.replayMu.RLock()
				entries := make([]replayEntry, len(r.replayBuf))
				copy(entries, r.replayBuf)
				r.replayMu.RUnlock()
				if len(entries) > 0 {
					r.logger.Info("replaying frames to reconnected client", zap.Int("count", len(entries)), zap.String("user_id", client.userID.String()))
					for _, e := range entries {
						select {
						case client.send <- e.data:
						default:
						}
					}
				}
			}
			resetTimer()

		case client := <-r.unregister:
			if _, ok := r.clients[client]; ok {
				delete(r.clients, client)
				close(client.send)
				r.logger.Info("client left room", zap.String("user_id", client.userID.String()))
				// If no clients left, timer will eventually kill room.
			}

		case msg := <-r.ingress:
			resetTimer()
			r.handleUserMessage(msg)

		case frame := <-r.llmIngress:
			resetTimer()
			// Message came from Redis (Hub broadcast), so it was already sent to User Room if needed.
			// Do NOT forward to User Room again.
			r.handleLLMMessage(frame, false)

		case frame := <-r.broadcast:
			resetTimer() // Reset timer on activity
			// Direct broadcast to all clients in this room
			// This matches handleLLMMessage logic but invoked externally
			b, err := json.Marshal(frame)
			if err != nil {
				r.logger.Error("failed to marshal broadcast frame", zap.Error(err))
				continue
			}
			for client := range r.clients {
				select {
				case client.send <- b:
				default:
					close(client.send)
					delete(r.clients, client)
				}
			}

		case <-timer.C:
			if len(r.clients) == 0 && !r.generationInProgress {
				r.logger.Info("room idle timeout, closing")
				r.flushAllBuilders()
				r.hub.unregister <- r
				return
			}
			if r.generationInProgress {
				r.logger.Debug("room has no clients but generation in progress, keeping alive")
			}
			// If clients exist, reset timer (shouldn't happen if resetTimer works, but safety)
			timer.Reset(idleTimeout)

		case <-r.generationTimeoutCh:
			// Handled in the room's goroutine to avoid races with r.clients and r.generationInProgress.
			if r.generationInProgress {
				r.logger.Warn("generation timeout reached, forcing stop")
				r.generationInProgress = false
				r.generationTimer = nil
				r.flushAllBuilders()
				r.sendGenerationTimeoutError()
			}

		}
	}
}

// sendGenerationTimeoutError sends a timeout error to all clients using
// the same ErrorInfo-based format as sendErrorFrame so the frontend can
// parse it uniformly via err.error.message.
func (r *Room) sendGenerationTimeoutError() {
	r.sendErrorFrame(
		ErrorCodeTimeout,
		"Generation timed out after 10 minutes. Please try again.",
		nil, // no underlying error
		uuid.New().String(),
		map[string]interface{}{"type": "timeout"},
	)
}
