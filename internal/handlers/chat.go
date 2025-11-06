package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

type ChatHandler struct {
	storage *storage.Storage
}

func NewChatHandler(storage *storage.Storage) *ChatHandler {
	return &ChatHandler{
		storage: storage,
	}
}

func (h *ChatHandler) GetChat(c *gin.Context) {
	var ctx = c.Request.Context()

	chatID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid UUID"})
		return
	}

	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	chat, err := h.storage.GetChat(ctx, user.ID, chatID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Chat not found"})
		return
	}

	c.JSON(http.StatusOK, chat)
}

func (h *ChatHandler) ListChats(c *gin.Context) {
	var ctx = c.Request.Context()

	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	chats, err := h.storage.GetUserChats(ctx, user.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Chat not found"})
		return
	}

	c.JSON(http.StatusOK, chats)
}

func (h *ChatHandler) UpdateChat(c *gin.Context) {
	var ctx = c.Request.Context()

	chatID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid UUID"})
		return
	}

	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	var updatedChat chat.Chat
	if err := c.ShouldBindJSON(&updatedChat); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updatedChat.ID = chatID
	chat, err := h.storage.UpdateChat(ctx, user.ID, &updatedChat)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, chat)
}

func (h *ChatHandler) DeleteChat(c *gin.Context) {
	var ctx = c.Request.Context()

	chatID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid UUID"})
		return
	}

	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	if err := h.storage.DeleteChat(ctx, user.ID, chatID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}
