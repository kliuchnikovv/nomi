package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/nomi-api/internal/apierror"
	"github.com/kliuchnikovv/nomi-api/internal/config"
	"github.com/kliuchnikovv/nomi-api/internal/services"
)

type ChatHandler struct {
	service        *services.ChatService
	messageService *services.MessageService
	cfg            *config.Config
	recapClient    *http.Client
}

func NewChatHandler(service *services.ChatService, messageService *services.MessageService, cfg *config.Config) *ChatHandler {
	return &ChatHandler{
		service:        service,
		messageService: messageService,
		cfg:            cfg,
		recapClient:    &http.Client{Timeout: 60 * time.Second},
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

// GetPersistentChat returns the most-recent persistent chat for the user, or nil if none exists.
func (h *ChatHandler) GetPersistentChat(c *gin.Context) {
	var ctx = c.Request.Context()

	user, err := userFromCtx(ctx)
	if err != nil {
		apierror.Respond(c, apierror.NewUnauthorized(err.Error()))
		return
	}

	chat, err := h.service.GetLatestPersistentChat(ctx, user.ID)
	if err != nil {
		apierror.Respond(c, apierror.NewInternalServerError(err.Error()))
		return
	}

	if chat == nil {
		c.JSON(http.StatusOK, nil)
		return
	}

	c.JSON(http.StatusOK, chat)
}

// ListPersistentChats returns all persistent chats for the user, newest first.
func (h *ChatHandler) ListPersistentChats(c *gin.Context) {
	var ctx = c.Request.Context()

	user, err := userFromCtx(ctx)
	if err != nil {
		apierror.Respond(c, apierror.NewUnauthorized(err.Error()))
		return
	}

	chats, err := h.service.ListPersistentChats(ctx, user.ID)
	if err != nil {
		apierror.Respond(c, apierror.NewInternalServerError(err.Error()))
		return
	}

	c.JSON(http.StatusOK, chats)
}

// ArchiveMessages marks given messages as archived.
func (h *ChatHandler) ArchiveMessages(c *gin.Context) {
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

	var req struct {
		MessageIDs []uuid.UUID `json:"message_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.MessageIDs) == 0 {
		apierror.Respond(c, apierror.NewBadRequest("message_ids required", nil))
		return
	}

	if err := h.service.ArchiveMessages(ctx, user.ID, chatID, req.MessageIDs); err != nil {
		apierror.Respond(c, apierror.NewInternalServerError(err.Error()))
		return
	}

	c.JSON(http.StatusNoContent, nil)
}
