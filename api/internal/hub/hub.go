package hub

import (
	"encoding/json"
	"net/http"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

type Hub struct {
	rooms map[uuid.UUID]*Room
	mu    sync.RWMutex

	unregister chan *Room

	store      *storage.Storage
	logger     *zap.Logger
	llmBaseURL string

	upgrader websocket.Upgrader
}

func NewHub(store *storage.Storage, logger *zap.Logger, llmBaseURL string) *Hub {
	return &Hub{
		rooms:      make(map[uuid.UUID]*Room),
		unregister: make(chan *Room),
		store:      store,
		logger:     logger.With(zap.String("component", "hub")),
		llmBaseURL: llmBaseURL,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
	}
}

func (h *Hub) Run() {
	for room := range h.unregister {
		h.mu.Lock()
		if _, ok := h.rooms[room.ID]; ok {
			delete(h.rooms, room.ID)
			h.logger.Info("room closed", zap.String("room_id", room.ID.String()))
		}
		h.mu.Unlock()
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
