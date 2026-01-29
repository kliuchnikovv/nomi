package hub

import (
	"encoding/json"
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
	broadcast  chan Frame // Channel for direct broadcasting (bypassing logic)
	register   chan *Client
	unregister chan *Client

	// Ingress for LLM frames from Redis (e.g. from Python team agents)
	llmIngress chan Frame

	// Team Mode
	mode string // "agent" or "team"

	command string // JSON-encoded team command

	// Generation state - prevents room from closing while LLM is generating
	generationInProgress bool
	generationTimer      *time.Timer

	// Model for current generation (set when forwarding user message to Redis)
	currentModelID string

	// Message builders state (replacing currentMessageMetadata)
	messageBuilders map[uuid.UUID]*MessageBuilder
}

func NewRoom(hub *Hub, id uuid.UUID, roomType RoomType, initiatorID uuid.UUID, store *storage.Storage, logger *zap.Logger, llmBaseURL string, mode string, command string) *Room {
	return &Room{
		ID:              id,
		Type:            roomType,
		hub:             hub,
		logger:          logger.With(zap.String("room_id", id.String()), zap.String("type", string(roomType))),
		store:           store,
		initiatorID:     initiatorID,
		clients:         make(map[*Client]bool),
		ingress:         make(chan *ClientMessage),
		broadcast:       make(chan Frame),
		register:        make(chan *Client),
		unregister:      make(chan *Client),
		llmIngress:      make(chan Frame),
		mode:            mode,
		command:         command,
		messageBuilders: make(map[uuid.UUID]*MessageBuilder),
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
			r.clients[client] = true
			r.logger.Info("client joined room", zap.String("user_id", client.userID.String()))
			// Send initial sync if needed? Client fetches DB history.
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
				r.hub.unregister <- r
				return
			}
			if r.generationInProgress {
				r.logger.Debug("room has no clients but generation in progress, keeping alive")
			}
			// If clients exist, reset timer (shouldn't happen if resetTimer works, but safety)
			timer.Reset(idleTimeout)

		}
	}
}

// sendGenerationTimeoutError sends a timeout error to all clients
func (r *Room) sendGenerationTimeoutError() {
	payload := map[string]interface{}{
		"code":    "GENERATION_TIMEOUT",
		"message": "Generation timed out after 10 minutes. Please try again.",
		"type":    "timeout",
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		r.logger.Error("failed to marshal timeout payload", zap.Error(err))
		return
	}

	errorFrame := Frame{
		ID:        int(time.Now().Unix()),
		Kind:      SignalKind,
		Operation: ErrorOperation,
		ChatID:    r.ID,
		TraceID:   uuid.New().String(),
		Timestamp: time.Now(),
		Payload:   json.RawMessage(payloadBytes),
	}

	frameBytes, err := json.Marshal(errorFrame)
	if err != nil {
		r.logger.Error("failed to marshal timeout error frame", zap.Error(err))
		return
	}

	for client := range r.clients {
		select {
		case client.send <- frameBytes:
		default:
			close(client.send)
			delete(r.clients, client)
		}
	}
}
