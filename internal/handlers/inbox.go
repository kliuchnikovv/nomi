package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

type InboxHandler struct {
	storage *storage.Storage
}

func NewInboxHandler(storage *storage.Storage) *InboxHandler {
	return &InboxHandler{
		storage: storage,
	}
}

// ListInboxMessages handles GET /api/inbox with pagination
func (h *InboxHandler) ListInboxMessages(c *gin.Context) {
	ctx := c.Request.Context()

	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	// Parse pagination parameters
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))

	var integrationID *uuid.UUID
	if integrationParam := c.Query("integration_id"); integrationParam != "" {
		if id, err := uuid.Parse(integrationParam); err == nil {
			integrationID = &id
		}
	}

	response, err := h.storage.GetInboxMessages(ctx, user.ID, integrationID, page, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, response)
}

// GetInboxMessage handles GET /api/inbox/:id
func (h *InboxHandler) GetInboxMessage(c *gin.Context) {
	ctx := c.Request.Context()

	messageID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid message UUID"})
		return
	}

	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	message, err := h.storage.GetInboxMessage(ctx, user.ID, messageID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Message not found"})
		return
	}

	c.JSON(http.StatusOK, message)
}

// MarkAsRead handles PATCH /api/inbox/:id/read
func (h *InboxHandler) MarkAsRead(c *gin.Context) {
	ctx := c.Request.Context()

	messageID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid message UUID"})
		return
	}

	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	if err := h.storage.MarkAsRead(ctx, user.ID, messageID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Message not found"})
		return
	}

	c.JSON(http.StatusNoContent, gin.H{"message": "Message marked as read"})
}
