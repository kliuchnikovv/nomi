package hub

import (
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
	for {
		select {
		case room := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.rooms[room.ID]; ok {
				delete(h.rooms, room.ID)
				h.logger.Info("room closed", zap.String("room_id", room.ID.String()))
			}
			h.mu.Unlock()
		}
	}
}

func (h *Hub) ServeWs(w http.ResponseWriter, r *http.Request, chatID uuid.UUID, user *storage.User) {
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

	h.mu.Lock()
	room, ok := h.rooms[chatID]
	if !ok {
		room = NewRoom(h, chatID, user.ID, h.store, h.logger, h.llmBaseURL)
		h.rooms[chatID] = room
		go room.Run()
		h.logger.Info("room created", zap.String("room_id", chatID.String()))
	}
	h.mu.Unlock()

	client.room = room
	room.register <- client

	// Allow collection of memory referenced by the caller by doing all work in
	// new goroutines.
	go client.writePump()
	go client.readPump()
}
