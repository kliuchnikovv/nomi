package handlers

import (
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/kliuchnikovv/genie-api/internal/hub"
	"go.uber.org/zap"
)

// WorkerHandler accepts WebSocket connections from Python workers.
// Workers send response frames directly instead of going through Redis pub/sub.
type WorkerHandler struct {
	hub      *hub.Hub
	token    string
	upgrader websocket.Upgrader
	logger   *zap.Logger
}

func NewWorkerHandler(h *hub.Hub, logger *zap.Logger) *WorkerHandler {
	token := os.Getenv("WORKER_TOKEN")
	if token == "" {
		logger.Warn("WORKER_TOKEN not set — worker endpoint accepts any connection")
	}
	return &WorkerHandler{
		hub:    h,
		token:  token,
		logger: logger.With(zap.String("handler", "worker")),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

// WorkerWS upgrades the connection and registers it in the WorkerPool.
// Python workers authenticate with X-Worker-Token header (WORKER_TOKEN env var).
func (h *WorkerHandler) WorkerWS(c *gin.Context) {
	if h.token != "" && c.GetHeader("X-Worker-Token") != h.token {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid worker token"})
		return
	}
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		h.logger.Error("worker ws upgrade failed", zap.Error(err))
		return
	}
	h.logger.Info("python worker connected", zap.String("remote", c.Request.RemoteAddr))
	h.hub.WorkerPool().ServeWorker(conn, h.hub)
}
