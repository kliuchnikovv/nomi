package handlers

import (
	"fmt"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

type MessageHandler struct {
	storage *storage.Storage
}

func NewMessageHandler(storage *storage.Storage) *MessageHandler {
	return &MessageHandler{
		storage: storage,
	}
}

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

	log.Printf("CreateMessage: payload has %d attachments. IDs: %v", len(newMessage.AttachmentIDs), newMessage.AttachmentIDs)

	newMessage.ChatID = chatID
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
