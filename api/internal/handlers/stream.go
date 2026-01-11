package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/kliuchnikovv/genie-api/internal/hub"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

type StreamHandler struct {
	hub    *hub.Hub
	logger *zap.Logger
	store  *storage.Storage
}

func NewStreamHandler(
	logger *zap.Logger,
	hub *hub.Hub,
	store *storage.Storage,
) *StreamHandler {
	return &StreamHandler{
		hub:    hub,
		logger: logger.With(zap.String("handler", "stream")),
		store:  store,
	}
}

func (h *StreamHandler) ChatWS(c *gin.Context) {
	var ctx = c.Request.Context()
	user, _ := userFromCtx(ctx)
	if user == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "can't find user info in context"})
		return
	}

	h.logger.Info("client connected to websocket", zap.String("user_id", user.ID.String()))

	// Resolve Chat ID and Room Type
	var chatID uuid.UUID
	var roomType hub.RoomType = hub.RoomTypeChat

	// Check if this is a user channel request
	channel := c.Query("channel")
	if channel == "user" {
		chatID = user.ID
		roomType = hub.RoomTypeUser
		h.logger.Info("connecting to user notification channel", zap.String("user_id", user.ID.String()))
	} else {
		// Normal Chat Logic
		chatIDStr := c.Query("chat_id")
		if chatIDStr == "" {
			chatIDStr = c.Query("chatId")
		}

		if chatIDStr != "" {
			if id, err := uuid.Parse(chatIDStr); err == nil {
				chatID = id
			} else {
				h.logger.Warn("invalid chat_id format", zap.String("chat_id", chatIDStr))
			}
		}

		// Security check: verify user owns the chat
		if chatID != uuid.Nil {
			if _, err := h.store.GetChat(ctx, user.ID, chatID); err != nil {
				h.logger.Warn("user attempted to access invalid/unauthorized chat",
					zap.String("user_id", user.ID.String()),
					zap.String("chat_id", chatID.String()),
					zap.Error(err))
				c.JSON(http.StatusForbidden, gin.H{"error": "chat not found or access denied"})
				return
			}
		} else {
			// If no chat_id provided, generate one.
			// New chat session.
			chatID = uuid.New()
			h.logger.Info("no chat_id provided, generated new session_id", zap.String("session_id", chatID.String()))
		}
	}

	// Extract team mode params from query
	mode := c.Query("mode")
	if mode == "" {
		mode = "agent" // Default to agent mode
	}
	command := c.Query("command")
	if command == "" {
		command = c.Query("team")
	}

	h.logger.Info("websocket params",
		zap.String("mode", mode),
		zap.Bool("has_command", command != ""),
		zap.String("room_type", string(roomType)))

	h.hub.ServeWs(c.Writer, c.Request, chatID, roomType, user, mode, command)
}
