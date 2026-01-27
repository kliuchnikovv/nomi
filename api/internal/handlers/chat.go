package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/apierror"
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

func (h *ChatHandler) CreateChat(c *gin.Context) {
	var ctx = c.Request.Context()

	user, err := userFromCtx(ctx)
	if err != nil {
		apierror.Respond(c, apierror.NewUnauthorized(err.Error()))
		return
	}

	var newChat chat.Chat
	if err := c.ShouldBindJSON(&newChat); err != nil {
		apierror.Respond(c, apierror.NewBadRequest(err.Error(), nil))
		return
	}

	chat, err := h.storage.CreateChat(ctx, user.ID, &chat.Chat{
		ID:         uuid.New(),
		Model:      newChat.Model,
		Title:      newChat.Title,
		Mode:       newChat.Mode,
		TeamID:     newChat.TeamID,
		ProjectID:  newChat.ProjectID,
		TaskID:     newChat.TaskID,
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
		ArchivedAt: nil,
		DeletedAt:  nil,
	})
	if err != nil {
		apierror.Respond(c, apierror.NewInternalServerError(err.Error()))
		return
	}

	chat.Icon = getIconForTeam(chat.TeamID)

	c.JSON(http.StatusOK, chat)
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

	chat, err := h.storage.GetChat(ctx, user.ID, chatID)
	if err != nil {
		apierror.Respond(c, apierror.NewNotFound("Chat not found"))
		return
	}

	chat.Icon = getIconForTeam(chat.TeamID)

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
	var chats []*chat.Chat

	if ifModifiedSinceStr != "" {
		since, err := time.Parse(time.RFC3339, ifModifiedSinceStr)
		if err == nil {
			chats, err = h.storage.GetUserChatsModifiedAfter(ctx, user.ID, since)
			if err != nil {
				apierror.Respond(c, apierror.NewInternalServerError("Failed to fetch chats"))
				return
			}
			// If no chats were modified, return 304 Not Modified
			if len(chats) == 0 {
				c.Status(http.StatusNotModified)
				return
			}
		}
	}

	// Fallback to getting all chats if no timestamp or invalid timestamp
	if chats == nil {
		chats, err = h.storage.GetUserChats(ctx, user.ID)
		if err != nil {
			apierror.Respond(c, apierror.NewNotFound("Chat not found"))
			return
		}
	}

	for i := range chats {
		chats[i].Icon = getIconForTeam(chats[i].TeamID)
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

	var updatedChat chat.Chat
	if err := c.ShouldBindJSON(&updatedChat); err != nil {
		apierror.Respond(c, apierror.NewBadRequest(err.Error(), nil))
		return
	}

	updatedChat.ID = chatID
	chat, err := h.storage.UpdateChat(ctx, user.ID, &updatedChat)
	if err != nil {
		apierror.Respond(c, apierror.NewInternalServerError(err.Error()))
		return
	}

	chat.Icon = getIconForTeam(chat.TeamID)

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

	if err := h.storage.DeleteChat(ctx, user.ID, chatID); err != nil {
		apierror.Respond(c, apierror.NewInternalServerError(err.Error()))
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

func getIconForTeam(teamID *string) string {
	if teamID == nil {
		return ""
	}
	switch *teamID {
	case "dnd_team":
		return "d20"
	case "genie":
		return "sparkles"
	case "development_team":
		return "code"
	case "travel_planning":
		return "plane"
	case "analyst":
		return "search"
	case "architect":
		return "building"
	case "developer":
		return "terminal"
	case "worker":
		return "cog"
	case "reviewer":
		return "check"
	default:
		return ""
	}
}
