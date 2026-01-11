package hub

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type Hub struct {
	rooms     map[uuid.UUID]*Room
	userRooms map[uuid.UUID][]*Room // Optimization: index rooms by user
	mu        sync.RWMutex

	unregister chan *Room

	store       *storage.Storage
	logger      *zap.Logger
	llmBaseURL  string
	redisClient *redis.Client

	upgrader websocket.Upgrader
}

func NewHub(store *storage.Storage, logger *zap.Logger, llmBaseURL string, redisAddr string) *Hub {
	if redisAddr == "" {
		// Fallback if not configured, though config should handle it
		redisAddr = "redis:6379"
	}

	rdb := redis.NewClient(&redis.Options{
		Addr: redisAddr,
	})

	return &Hub{
		rooms:       make(map[uuid.UUID]*Room),
		userRooms:   make(map[uuid.UUID][]*Room),
		unregister:  make(chan *Room),
		store:       store,
		logger:      logger.With(zap.String("component", "hub")),
		llmBaseURL:  llmBaseURL,
		redisClient: rdb,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
	}
}

func (h *Hub) Run() {
	go h.subscribeToRedis()

	for room := range h.unregister {
		h.mu.Lock()
		if _, ok := h.rooms[room.ID]; ok {
			delete(h.rooms, room.ID)

			// Remove from userRooms index
			if rooms, ok := h.userRooms[room.initiatorID]; ok {
				newRooms := make([]*Room, 0, len(rooms))
				for _, r := range rooms {
					if r != room {
						newRooms = append(newRooms, r)
					}
				}
				if len(newRooms) == 0 {
					delete(h.userRooms, room.initiatorID)
				} else {
					h.userRooms[room.initiatorID] = newRooms
				}
			}

			h.logger.Info("room closed", zap.String("room_id", room.ID.String()))
		}
		h.mu.Unlock()
	}
}

func (h *Hub) subscribeToRedis() {
	ctx := context.Background()
	pubsub := h.redisClient.PSubscribe(ctx, "chat:user:*")
	defer pubsub.Close()

	ch := pubsub.Channel()
	h.logger.Info("subscribed to redis channels", zap.String("pattern", "chat:user:*"))

	for msg := range ch {
		// msg.Channel is "chat:user:{uuid}"
		parts := strings.Split(msg.Channel, ":")
		if len(parts) != 3 {
			h.logger.Warn("invalid redis channel format", zap.String("channel", msg.Channel))
			continue
		}

		userIDStr := parts[2]
		userID, err := uuid.Parse(userIDStr)
		if err != nil {
			h.logger.Warn("invalid user id in redis channel", zap.String("user_id_str", userIDStr), zap.Error(err))
			continue
		}

		var frame Frame
		if err := json.Unmarshal([]byte(msg.Payload), &frame); err != nil {
			h.logger.Warn("failed to unmarshal redis message", zap.Error(err))
			continue
		}

		h.BroadcastLLMFrameToUser(userID, frame)
	}
}

func (h *Hub) GetOrCreateRoom(roomID uuid.UUID, roomType RoomType, userID uuid.UUID, mode string, command string) (*Room, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room, ok := h.rooms[roomID]
	if !ok {
		room = NewRoom(h, roomID, roomType, userID, h.store, h.logger, h.llmBaseURL, mode, command)
		h.rooms[roomID] = room

		// Add to userRooms index
		h.userRooms[userID] = append(h.userRooms[userID], room)

		go room.Run()
		h.logger.Info("room created", zap.String("room_id", roomID.String()), zap.String("type", string(roomType)), zap.String("mode", mode))
	}
	return room, nil
}

func (h *Hub) BroadcastToUser(userID uuid.UUID, frame Frame) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	payload, err := json.Marshal(frame)
	if err != nil {
		h.logger.Error("failed to marshal broadcast frame", zap.Error(err))
		return
	}

	for _, room := range h.rooms {
		if room.initiatorID == userID {
			room.InjectMessage(userID, payload)
		}
	}
}

func (h *Hub) BroadcastLLMFrameToUser(userID uuid.UUID, frame Frame) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if rooms, ok := h.userRooms[userID]; ok {
		for _, room := range rooms {
			room.HandleRedisFrame(frame)
		}
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
