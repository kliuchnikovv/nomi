package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/kliuchnikovv/genie-api/internal/githubapp"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type Hub struct {
	rooms      map[uuid.UUID]*Room
	userRooms  map[uuid.UUID][]*Room // secondary index: initiatorID → rooms
	mu         sync.RWMutex
	workerPool *WorkerPool

	unregister chan *Room

	store      *storage.Storage
	logger     *zap.Logger
	llmBaseURL string
	redis      *redis.Client
	cryptoKey  []byte
	githubApp  *githubapp.Client

	upgrader websocket.Upgrader

	streamingMu  sync.RWMutex
	streamingMap map[string]bool // model ID -> streaming
}

func NewHub(store *storage.Storage, logger *zap.Logger, llmBaseURL string, cryptoKey []byte, ghApp *githubapp.Client) *Hub {
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
		userRooms:  make(map[uuid.UUID][]*Room),
		workerPool: NewWorkerPool(logger),
		unregister: make(chan *Room),
		store:      store,
		logger:     logger.With(zap.String("component", "hub")),
		llmBaseURL: llmBaseURL,
		redis:      rClient,
		cryptoKey:  cryptoKey,
		githubApp:  ghApp,
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

const channelClientToolResultPattern = "chat:client_tool_result:%s"

// channelDeferredActionResult carries results of queued (deferred) client
// actions that were drained by the device after the originating brain run had
// already finished. A Python subscriber loads the delivery context and sends a
// follow-up message on the originating channel (e.g. Telegram).
const channelDeferredActionResult = "chat:deferred_action_result"

func (h *Hub) Run() {
	for room := range h.unregister {
		h.mu.Lock()
		if _, ok := h.rooms[room.ID]; ok {
			delete(h.rooms, room.ID)
			// Remove from userRooms index
			uid := room.initiatorID
			rooms := h.userRooms[uid]
			for i, r := range rooms {
				if r.ID == room.ID {
					h.userRooms[uid] = append(rooms[:i], rooms[i+1:]...)
					break
				}
			}
			if len(h.userRooms[uid]) == 0 {
				delete(h.userRooms, uid)
			}
			h.logger.Info("room closed", zap.String("room_id", room.ID.String()))
		}
		h.mu.Unlock()
	}
}

// PublishClientToolResult publishes a client tool result to Redis on a per-session channel
// so the Python worker can complete the round-trip.
func (h *Hub) PublishClientToolResult(ctx context.Context, sessionID, callID, result string) error {
	payload := map[string]string{"call_id": callID, "result": result}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	// Publish to per-session channel
	channel := fmt.Sprintf(channelClientToolResultPattern, sessionID)
	h.logger.Info("Publishing client tool result",
		zap.String("channel", channel),
		zap.String("call_id", callID),
		zap.Int("result_len", len(result)),
	)
	return h.redis.Publish(ctx, channel, payloadBytes).Err()
}

// PublishDeferredActionResult publishes a drained queued-action result to the
// deferred-result channel so a Python subscriber can deliver a follow-up to the
// originating channel. rawDeliveryContext is the JSONB delivery_context bytes
// (may be nil).
func (h *Hub) PublishDeferredActionResult(ctx context.Context, source, sessionID, callID, result string, rawDeliveryContext []byte) error {
	var deliveryContext map[string]interface{}
	if len(rawDeliveryContext) > 0 {
		_ = json.Unmarshal(rawDeliveryContext, &deliveryContext)
	}
	payload := map[string]interface{}{
		"source":           source,
		"session_id":       sessionID,
		"call_id":          callID,
		"result":           result,
		"delivery_context": deliveryContext,
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	h.logger.Info("Publishing deferred action result",
		zap.String("channel", channelDeferredActionResult),
		zap.String("call_id", callID),
		zap.String("source", source),
	)
	return h.redis.Publish(ctx, channelDeferredActionResult, payloadBytes).Err()
}

func (h *Hub) subscribeRedis() {
	const reconnectDelay = 2 * time.Second
	const maxReconnectDelay = 30 * time.Second

	delay := reconnectDelay

	for {
		ctx := context.Background()
		pubsub := h.redis.PSubscribe(ctx, "chat:user:*")
		ch := pubsub.Channel()

		h.logger.Info("started redis subscription", zap.String("pattern", "chat:user:*"))

		for msg := range ch {
			// Reset delay on successful message (connection is healthy)
			delay = reconnectDelay

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

			var frame Frame
			if err := json.Unmarshal([]byte(msg.Payload), &frame); err != nil {
				h.logger.Warn("failed to parse redis message payload", zap.Error(err))
				continue
			}

			h.BroadcastToUser(userID, frame)
		}

		// Channel closed — Redis connection lost or pubsub error.
		pubsub.Close()

		h.logger.Error("redis subscription disconnected, reconnecting",
			zap.Duration("delay", delay),
		)

		time.Sleep(delay)
		delay = delay * 2
		if delay > maxReconnectDelay {
			delay = maxReconnectDelay
		}

		// Try to ping Redis before re-subscribing
		pingCtx, pingCancel := context.WithTimeout(context.Background(), 5*time.Second)
		if _, err := h.redis.Ping(pingCtx).Result(); err != nil {
			h.logger.Error("redis ping failed during reconnect", zap.Error(err))
		}
		pingCancel()
	}
}

func (h *Hub) GetOrCreateRoom(roomID uuid.UUID, roomType RoomType, userID uuid.UUID, mode string, command string, timezone string) (*Room, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room, ok := h.rooms[roomID]
	if !ok {
		room = NewRoom(h, roomID, roomType, userID, h.store, h.logger, h.llmBaseURL, mode, command, timezone)
		h.rooms[roomID] = room
		h.userRooms[userID] = append(h.userRooms[userID], room)
		go room.Run()
		h.logger.Info("room created", zap.String("room_id", roomID.String()), zap.String("type", string(roomType)), zap.String("mode", mode), zap.String("timezone", timezone))
	}
	return room, nil
}

// BroadcastToUser sends a frame to the user's rooms. Stream chunks (op=message, kind=data)
// are sent only to the matching chat room to avoid duplicate delivery when the same
// user has both a chat connection and a user-channel connection (e.g. NotificationContext).
func (h *Hub) BroadcastToUser(userID uuid.UUID, frame Frame) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	rooms := h.userRooms[userID]
	h.logger.Info("broadcasting to user via redis", zap.String("user_id", userID.String()), zap.Int("user_rooms", len(rooms)))

	found := 0
	for _, room := range rooms {
		// Stream chunks (message/data) go only to the chat room for this chat.
		// User room gets done, signal, error etc. so NotificationContext still receives task updates.
		if room.Type == RoomTypeUser {
			if frame.Operation == MessageOperation && frame.Kind == TokenKind {
				continue
			}
		}
		if room.Type == RoomTypeChat {
			if frame.ChatID != uuid.Nil && frame.ChatID != room.ID {
				continue
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

func (h *Hub) ServeWs(w http.ResponseWriter, r *http.Request, roomID uuid.UUID, roomType RoomType, user *storage.User, mode string, command string, timezone string) {
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

	room, err := h.GetOrCreateRoom(roomID, roomType, user.ID, mode, command, timezone)
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

// Redis returns the Redis client for use by other components
func (h *Hub) Redis() *redis.Client {
	return h.redis
}

// WorkerPool returns the pool of connected Python workers.
func (h *Hub) WorkerPool() *WorkerPool {
	return h.workerPool
}
