package handlers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"gorm.io/gorm"
)

// PluginChatsHandler exposes CRUD for plugin chats (e.g., Gmail threads).
type PluginChatsHandler struct {
	storage *storage.Storage
}

func NewPluginChatsHandler(storage *storage.Storage) *PluginChatsHandler {
	return &PluginChatsHandler{storage: storage}
}

type PluginChatDTO struct {
	ID            uuid.UUID `json:"id"`
	Title         string    `json:"title"`
	Provider      string    `json:"provider"`
	IntegrationID uuid.UUID `json:"integration_id"`
	ExternalID    string    `json:"external_id"`
	LastReceived  *int64    `json:"last_received,omitempty"`
	Count         int64     `json:"count"`
	LastTitle     string    `json:"last_title,omitempty"`
	LastSummary   string    `json:"last_summary,omitempty"`
	CreatedAt     int64     `json:"created_at"`
	UpdatedAt     int64     `json:"updated_at"`
}

// ListPluginChats returns plugin chats with stats, filtered by provider and optional integration_id.
func (h *PluginChatsHandler) ListPluginChats(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	provider := c.Query("provider")
	if provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider is required"})
		return
	}

	var integrationFilter *uuid.UUID
	if integIDStr := c.Query("integration_id"); integIDStr != "" {
		integID, err := uuid.Parse(integIDStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid integration_id"})
			return
		}
		integrationFilter = &integID
	}

	chats, err := h.storage.ListPluginChatsWithStats(ctx, user.ID, provider, integrationFilter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load plugin chats"})
		return
	}

	resp := make([]PluginChatDTO, 0, len(chats))
	for _, chat := range chats {
		var last *int64
		if chat.LastReceived != nil {
			ts := chat.LastReceived.Unix()
			last = &ts
		}
		resp = append(resp, PluginChatDTO{
			ID:            chat.ID,
			Title:         chat.Title,
			Provider:      chat.Provider,
			IntegrationID: chat.IntegrationID,
			ExternalID:    chat.ExternalID,
			LastReceived:  last,
			Count:         chat.Count,
			LastTitle:     chat.LastTitle,
			LastSummary:   chat.LastSummary,
			CreatedAt:     chat.CreatedAt.Unix(),
			UpdatedAt:     chat.UpdatedAt.Unix(),
		})
	}

	c.JSON(http.StatusOK, gin.H{"items": resp})
}

// UpdatePluginChat updates mutable fields (title).
func (h *PluginChatsHandler) UpdatePluginChat(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	chatID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid chat id"})
		return
	}

	var payload struct {
		Title string `json:"title"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil || payload.Title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title is required"})
		return
	}

	updated, err := h.storage.UpdatePluginChatTitle(ctx, user.ID, chatID, payload.Title)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update plugin chat"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":             updated.ID,
		"title":          updated.Title,
		"provider":       updated.Provider,
		"integration_id": updated.IntegrationID,
		"external_id":    updated.ExternalID,
	})
}

// DeletePluginChat deletes a plugin chat.
func (h *PluginChatsHandler) DeletePluginChat(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	chatID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid chat id"})
		return
	}

	if err := h.storage.DeletePluginChat(ctx, user.ID, chatID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete plugin chat"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}
