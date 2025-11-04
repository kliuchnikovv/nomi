package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

var zeroUUID = uuid.MustParse("00000000-0000-0000-0000-000000000000")

type MessageHandler struct {
	storage  *storage.Storage
	notifier interface { // minimal notifier interface to avoid tight coupling
		Publish(chatID uuid.UUID, ev interface{})
	}
}

func NewMessageHandler(storage *storage.Storage) *MessageHandler {
	return &MessageHandler{
		storage: storage,
	}
}

// WithNotifier configures optional notifier to push events to clients.
func (h *MessageHandler) WithNotifier(publish func(chatID uuid.UUID, ev interface{})) *MessageHandler {
	h.notifier = &publisher{fn: publish}
	return h
}

type publisher struct{ fn func(uuid.UUID, interface{}) }

func (p *publisher) Publish(chatID uuid.UUID, ev interface{}) { p.fn(chatID, ev) }

func (h *MessageHandler) CreateMessage(c *gin.Context) {
	var ctx = c.Request.Context()

	chatID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid chat UUID"})
		return
	}

	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	var newMessage chat.Message
	if err := c.ShouldBindJSON(&newMessage); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var chatObj *chat.Chat
	if chatID != zeroUUID {
		chatObj, err = h.storage.GetChat(ctx, user.ID, chatID)
	} else {
		chatObj, err = h.storage.CreateChat(ctx, user.ID, &chat.Chat{
			ID:         uuid.New(),
			Model:      uuid.New(), // TODO: replace with actual models
			Title:      newMessage.Text,
			CreatedAt:  time.Now().UTC(),
			UpdatedAt:  time.Now().UTC(),
			ArchivedAt: nil,
			DeletedAt:  nil,
		})
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	newMessage.ChatID = chatObj.ID
	createdMessage, err := h.storage.CreateMessage(ctx, user.ID, &newMessage)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	log.Printf("message: user=%s chat=%s created message id=%s", user.ID, createdMessage.ChatID, createdMessage.ID)
	c.JSON(http.StatusCreated, createdMessage)
}

func (h *MessageHandler) GetMessages(c *gin.Context) {
	var ctx = c.Request.Context()

	chatID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid chat UUID"})
		return
	}

	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	messages, err := h.storage.GetMessages(ctx, user.ID, chatID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, messages)
}

// Events streams chat-related events (SSE). Client should use EventSource.
func (h *MessageHandler) Events(c *gin.Context) {
	ctx := c.Request.Context()
	chatID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid chat UUID"})
		return
	}
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	// Verify access by attempting to load chat
	if _, err := h.storage.GetChat(ctx, user.ID, chatID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
		return
	}
	// Notifier must be configured
	if h.notifier == nil {
		c.JSON(http.StatusNotImplemented, gin.H{"error": "events not enabled"})
		return
	}

	// We rely on server wiring to provide a notifier with Subscribe/Unsubscribe behavior.
	// To keep handler decoupled, server will wrap it.
	type subber interface {
		Subscribe(chatID uuid.UUID) chan map[string]interface{}
		Unsubscribe(chatID uuid.UUID, ch chan map[string]interface{})
	}
	// server injects a subber via context keys
	val := c.MustGet("chatEventsSub")
	s, ok := val.(subber)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "events not available"})
		return
	}

	ch := s.Subscribe(chatID)
	defer s.Unsubscribe(chatID, ch)

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.WriteHeader(http.StatusOK)

	// initial comment to establish stream
	if _, err := c.Writer.Write([]byte(":ok\n\n")); err != nil {
		return
	}
	c.Writer.Flush()

	// Stream loop
	for {
		select {
		case <-ctx.Done():
			return
		case ev := <-ch:
			// very small JSON writer
			data, _ := json.Marshal(ev)
			if _, err := c.Writer.Write([]byte("data: ")); err != nil {
				return
			}
			if _, err := c.Writer.Write(data); err != nil {
				return
			}
			if _, err := c.Writer.Write([]byte("\n\n")); err != nil {
				return
			}
			c.Writer.Flush()
		}
	}
}

// userFromCtx mirrors the helper in message handler to extract authenticated user
func userFromCtx(ctx interface{ Value(key any) any }) (*storage.User, error) {
	v := ctx.Value(auth.UserContextKey)
	if v == nil {
		return nil, fmt.Errorf("user not found in context")
	}
	switch u := v.(type) {
	case *storage.User:
		return u, nil
	case storage.User:
		return &u, nil
	default:
		return nil, fmt.Errorf("user found with different type")
	}
}
