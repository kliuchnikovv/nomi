package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/apierror"
	"github.com/kliuchnikovv/genie-api/internal/services"
)

type ChatHandler struct {
	service *services.ChatService
}

func NewChatHandler(service *services.ChatService) *ChatHandler {
	return &ChatHandler{
		service: service,
	}
}

func (h *ChatHandler) CreateChat(c *gin.Context) {
	var ctx = c.Request.Context()

	user, err := userFromCtx(ctx)
	if err != nil {
		apierror.Respond(c, apierror.NewUnauthorized(err.Error()))
		return
	}

	var req services.CreateChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		apierror.Respond(c, apierror.NewBadRequest(err.Error(), nil))
		return
	}

	createdChat, err := h.service.CreateChat(ctx, user.ID, &req)
	if err != nil {
		apierror.Respond(c, apierror.NewInternalServerError(err.Error()))
		return
	}

	c.JSON(http.StatusOK, createdChat)
}

func (h *ChatHandler) GetChat(c *gin.Context) {
	var ctx = c.Request.Context()

	chatID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		apierror.Respond(c, apierror.NewBadRequest("Invalid UUID", nil))
		return
	}

	user, err := userFromCtx(ctx)
	if err != nil {
		apierror.Respond(c, apierror.NewUnauthorized(err.Error()))
		return
	}

	chat, err := h.service.GetChat(ctx, user.ID, chatID)
	if err != nil {
		apierror.Respond(c, apierror.NewNotFound("Chat not found"))
		return
	}

	c.JSON(http.StatusOK, chat)
}

func (h *ChatHandler) ListChats(c *gin.Context) {
	var ctx = c.Request.Context()

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

	chats, err := h.service.ListChats(ctx, user.ID, ifModifiedSince)
	if err != nil {
		apierror.Respond(c, apierror.NewInternalServerError("Failed to fetch chats"))
		return
	}

	// If no chats were modified, return 304 Not Modified
	if ifModifiedSince != nil && len(chats) == 0 {
		c.Status(http.StatusNotModified)
		return
	}

	c.JSON(http.StatusOK, chats)
}

func (h *ChatHandler) UpdateChat(c *gin.Context) {
	var ctx = c.Request.Context()

	chatID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		apierror.Respond(c, apierror.NewBadRequest("Invalid UUID", nil))
		return
	}

	user, err := userFromCtx(ctx)
	if err != nil {
		apierror.Respond(c, apierror.NewUnauthorized(err.Error()))
		return
	}

	var req services.UpdateChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		apierror.Respond(c, apierror.NewBadRequest(err.Error(), nil))
		return
	}

	chat, err := h.service.UpdateChat(ctx, user.ID, chatID, &req)
	if err != nil {
		apierror.Respond(c, apierror.NewInternalServerError(err.Error()))
		return
	}

	c.JSON(http.StatusOK, chat)
}

func (h *ChatHandler) DeleteChat(c *gin.Context) {
	var ctx = c.Request.Context()

	chatID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		apierror.Respond(c, apierror.NewBadRequest("Invalid UUID", nil))
		return
	}

	user, err := userFromCtx(ctx)
	if err != nil {
		apierror.Respond(c, apierror.NewUnauthorized(err.Error()))
		return
	}

	if err := h.service.DeleteChat(ctx, user.ID, chatID); err != nil {
		apierror.Respond(c, apierror.NewInternalServerError(err.Error()))
		return
	}

	c.JSON(http.StatusNoContent, nil)
}
