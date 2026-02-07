package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/apierror"
	"github.com/kliuchnikovv/genie-api/internal/services"
)

type MessageHandler struct {
	service *services.MessageService
}

func NewMessageHandler(service *services.MessageService) *MessageHandler {
	return &MessageHandler{
		service: service,
	}
}

func (h *MessageHandler) CreateMessage(c *gin.Context) {
	var ctx = c.Request.Context()

	chatID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		apierror.Respond(c, apierror.NewBadRequest("Invalid chat UUID", nil))
		return
	}

	user, err := userFromCtx(ctx)
	if err != nil {
		apierror.Respond(c, apierror.NewUnauthorized(err.Error()))
		return
	}

	var req services.CreateMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		apierror.Respond(c, apierror.NewBadRequest(err.Error(), nil))
		return
	}

	createdMessage, err := h.service.CreateMessage(ctx, user.ID, chatID, &req)
	if err != nil {
		apierror.Respond(c, apierror.NewInternalServerError(err.Error()))
		return
	}

	c.JSON(http.StatusCreated, createdMessage)
}

// InternalCreateMessage creates a message using X-User-ID header (no JWT auth).
// Used by plugins (Python back-end) to persist messages through Go API
// instead of writing directly to the database.
func (h *MessageHandler) InternalCreateMessage(c *gin.Context) {
	chatID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		apierror.Respond(c, apierror.NewBadRequest("Invalid chat UUID", nil))
		return
	}

	userIDStr := c.GetHeader("X-User-ID")
	if userIDStr == "" {
		apierror.Respond(c, apierror.NewUnauthorized("X-User-ID header required"))
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		apierror.Respond(c, apierror.NewBadRequest("Invalid X-User-ID", nil))
		return
	}

	var req services.CreateMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		apierror.Respond(c, apierror.NewBadRequest(err.Error(), nil))
		return
	}

	createdMessage, err := h.service.CreateMessage(c.Request.Context(), userID, chatID, &req)
	if err != nil {
		apierror.Respond(c, apierror.NewInternalServerError(err.Error()))
		return
	}

	c.JSON(http.StatusCreated, createdMessage)
}

func (h *MessageHandler) GetMessages(c *gin.Context) {
	var ctx = c.Request.Context()

	chatID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		apierror.Respond(c, apierror.NewBadRequest("Invalid chat UUID", nil))
		return
	}

	user, err := userFromCtx(ctx)
	if err != nil {
		apierror.Respond(c, apierror.NewUnauthorized(err.Error()))
		return
	}

	// Check for If-Modified-Since query param for conditional GET
	ifModifiedSinceStr := c.Query("if_modified_since")
	var ifModifiedSince *time.Time

	if ifModifiedSinceStr != "" {
		since, err := time.Parse(time.RFC3339, ifModifiedSinceStr)
		if err == nil {
			ifModifiedSince = &since
		}
	}

	req := &services.GetMessagesRequest{
		IfModifiedSince: ifModifiedSince,
	}
	messages, err := h.service.GetMessages(ctx, user.ID, chatID, req)
	if err != nil {
		apierror.Respond(c, apierror.NewInternalServerError("Failed to fetch messages"))
		return
	}

	// If no messages were created after timestamp, return 304 Not Modified
	if ifModifiedSince != nil && len(messages) == 0 {
		c.Status(http.StatusNotModified)
		return
	}

	c.JSON(http.StatusOK, messages)
}
