package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

type BotIdentityHandler struct {
	store  *storage.Storage
	logger *zap.Logger
}

func NewBotIdentityHandler(store *storage.Storage, logger *zap.Logger) *BotIdentityHandler {
	return &BotIdentityHandler{store: store, logger: logger}
}

func (h *BotIdentityHandler) GetBotIdentity(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)

	identity, err := h.store.GetBotIdentity(c.Request.Context(), userID)
	if err != nil {
		h.logger.Error("failed to get bot identity", zap.Error(err), zap.String("user_id", userID.String()))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get bot identity"})
		return
	}

	c.JSON(http.StatusOK, identity)
}

func (h *BotIdentityHandler) UpsertBotIdentity(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)

	var req struct {
		Name         string `json:"name"`
		Instructions string `json:"instructions"`
		Tone         string `json:"tone"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	if req.Tone != "formal" && req.Tone != "casual" && req.Tone != "playful" {
		req.Tone = "casual"
	}
	if req.Name == "" {
		req.Name = "Souper"
	}

	identity := &storage.BotIdentity{
		UserID:       userID,
		Name:         req.Name,
		Instructions: req.Instructions,
		Tone:         req.Tone,
	}

	if err := h.store.UpsertBotIdentity(c.Request.Context(), identity); err != nil {
		h.logger.Error("failed to upsert bot identity", zap.Error(err), zap.String("user_id", userID.String()))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save bot identity"})
		return
	}

	c.JSON(http.StatusOK, identity)
}
