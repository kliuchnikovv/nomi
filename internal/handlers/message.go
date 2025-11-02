package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
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
	chatID := c.Param("id")
	uid, err := uuid.Parse(chatID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid chat UUID"})
		return
	}

	var newMessage chat.Message
	if err := c.ShouldBindJSON(&newMessage); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	newMessage.ChatID = uid
	createdMessage, err := h.storage.CreateMessage(&newMessage)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, createdMessage)
}

func (h *MessageHandler) GetMessages(c *gin.Context) {
	chatID := c.Param("id")
	uid, err := uuid.Parse(chatID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid chat UUID"})
		return
	}

	messages, err := h.storage.GetMessages(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, messages)
}
