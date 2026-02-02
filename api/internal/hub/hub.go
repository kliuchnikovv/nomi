package hub

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type Hub struct {
	rooms map[uuid.UUID]*Room
	mu    sync.RWMutex

	unregister chan *Room

	store      *storage.Storage
	logger     *zap.Logger
	llmBaseURL string
	redis      *redis.Client

	upgrader websocket.Upgrader

	streamingMu  sync.RWMutex
	streamingMap map[string]bool // model ID -> streaming
}

func NewHub(store *storage.Storage, logger *zap.Logger, llmBaseURL string) *Hub {
	// Initialize Redis
	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "localhost:6379" // Fallback for local dev without docker
	}

	// Handle redis:// prefix if present (common in connection strings)
	opt, err := redis.ParseURL(redisAddr)
	if err != nil {
		// If parse fails (e.g. host:port format or no schema), try creating options directly
		opt = &redis.Options{
			Addr: redisAddr,
		}
	}

	rClient := redis.NewClient(opt)

	// Ping Redis
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := rClient.Ping(ctx).Result(); err != nil {
		// Log but don't crash - maybe it comes up later
		logger.Error("failed to connect to redis", zap.Error(err))
	} else {
		logger.Info("connected to redis", zap.String("addr", redisAddr))
	}

	h := &Hub{
		rooms:      make(map[uuid.UUID]*Room),
		unregister: make(chan *Room),
		store:      store,
		logger:     logger.With(zap.String("component", "hub")),
		llmBaseURL: llmBaseURL,
		redis:      rClient,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
	}

	h.initStreamingMap()
	// Start Redis Subscriber
	go h.subscribeRedis()

	return h
}

const channelClientToolResult = "chat:client_tool_result"

func (h *Hub) Run() {
	// Periodic cleanup or metrics?
	for room := range h.unregister {
		h.mu.Lock()
		if _, ok := h.rooms[room.ID]; ok {
			delete(h.rooms, room.ID)
			h.logger.Info("room closed", zap.String("room_id", room.ID.String()))
		}
		h.mu.Unlock()
	}
}

// PublishClientToolResult publishes a client tool result to Redis so the Python worker can complete the round-trip.
func (h *Hub) PublishClientToolResult(ctx context.Context, callID, result string) error {
	payload := map[string]string{"call_id": callID, "result": result}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return h.redis.Publish(ctx, channelClientToolResult, payloadBytes).Err()
}

func (h *Hub) subscribeRedis() {
	ctx := context.Background()
	// Subscribe to all user channels
	pubsub := h.redis.PSubscribe(ctx, "chat:user:*")
	defer pubsub.Close()

	ch := pubsub.Channel()

	h.logger.Info("started redis subscription", zap.String("pattern", "chat:user:*"))

	for msg := range ch {
		// msg.Channel is the full channel name, e.g. "chat:user:123-456..."
		// msg.Payload is the JSON string

		h.logger.Info("REDIS RECEIVED",
			zap.String("channel", msg.Channel),
			zap.Int("len", len(msg.Payload)),
		)

		// Extract userID from channel
		// Format: chat:user:<uuid>
		var userIDStr string
		if len(msg.Channel) > 10 { // "chat:user:" is 10 chars
			userIDStr = msg.Channel[10:]
		}

		userID, err := uuid.Parse(userIDStr)
		if err != nil {
			h.logger.Warn("invalid user id in redis channel", zap.String("channel", msg.Channel), zap.String("id_part", userIDStr))
			continue
		}

		h.logger.Info("parsed user id from redis channel", zap.String("user_id", userID.String()))

		// Parse frame to validate it
		// We expect the payload to be a JSON string of Frame or just arbitrary JSON
		// For now, let's assume it's a valid JSON that the frontend can handle
		// Or we can try to parse into Frame to be safe
		var frame Frame
		if err := json.Unmarshal([]byte(msg.Payload), &frame); err != nil {
			h.logger.Warn("failed to parse redis message payload", zap.Error(err))
			continue
		}

		// Broadcast to user's connected clients
		h.BroadcastToUser(userID, frame)
	}
}

func (h *Hub) GetOrCreateRoom(roomID uuid.UUID, roomType RoomType, userID uuid.UUID, mode string, command string) (*Room, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room, ok := h.rooms[roomID]
	if !ok {
		room = NewRoom(h, roomID, roomType, userID, h.store, h.logger, h.llmBaseURL, mode, command)
		h.rooms[roomID] = room
		go room.Run()
		h.logger.Info("room created", zap.String("room_id", roomID.String()), zap.String("type", string(roomType)), zap.String("mode", mode))
	}
	return room, nil
}

// BroadcastToUser sends a frame to the user's rooms. Stream chunks (op=message, kind=data)
// are sent only to the matching chat room to avoid duplicate delivery when the same
// user has both a chat connection and a user-channel connection (e.g. NotificationContext).
func (h *Hub) BroadcastToUser(userID uuid.UUID, frame Frame) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	h.logger.Info("broadcasting to user via redis", zap.String("user_id", userID.String()), zap.Int("total_rooms", len(h.rooms)))

	found := 0
	for _, room := range h.rooms {
		if room.initiatorID != userID {
			continue
		}
		// Stream chunks (message/data) go only to the chat room for this chat.
		// User room gets done, signal, error etc. so NotificationContext still receives task updates.
		if room.Type == RoomTypeUser {
			if frame.Operation == MessageOperation && frame.Kind == TokenKind {
				continue // do not send stream chunks to user channel — prevents duplicate addMessage on front
			}
		}
		if room.Type == RoomTypeChat {
			if frame.ChatID != uuid.Nil && frame.ChatID != room.ID {
				continue // send only to the room that matches this chat
			}
		}
		h.logger.Info("found matching room for user", zap.String("room_id", room.ID.String()))
		room.HandleRemoteLLMFrame(frame)
		found++
	}
	if found == 0 {
		h.logger.Warn("no active rooms found for user", zap.String("user_id", userID.String()))
	}
}

func (h *Hub) ServeWs(w http.ResponseWriter, r *http.Request, roomID uuid.UUID, roomType RoomType, user *storage.User, mode string, command string) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error("failed to upgrade websocket", zap.Error(err))
		return
	}

	client := &Client{
		hub:    h,
		conn:   conn,
		send:   make(chan []byte, 256),
		userID: user.ID,
		logger: h.logger.With(zap.String("client_id", user.ID.String())),
	}

	room, err := h.GetOrCreateRoom(roomID, roomType, user.ID, mode, command)
	if err != nil {
		h.logger.Error("failed to get/create room", zap.Error(err))
		return
	}

	client.room = room
	room.register <- client

	// Allow collection of memory referenced by the caller by doing all work in
	// new goroutines.
	go client.writePump()
	go client.readPump()
}
