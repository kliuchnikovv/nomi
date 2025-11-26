package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/plugins"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

type ActionsHandler struct {
	storage       *storage.Storage
	logger        *zap.Logger
	pluginManager *plugins.Manager
}

func NewActionsHandler(storage *storage.Storage, logger *zap.Logger, pluginManager *plugins.Manager) *ActionsHandler {
	return &ActionsHandler{
		storage:       storage,
		logger:        logger.With(zap.String("component", "actions_handler")),
		pluginManager: pluginManager,
	}
}

type ExecuteActionRequest struct {
	Command string  `json:"command" binding:"required"`
	Agent   string  `json:"agent"`
	URL     *string `json:"url"`
	Prompt  *string `json:"prompt"`
}

type ExecuteActionResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Result  string `json:"result,omitempty"`
}

// ExecuteAction handles POST /api/inbox/:id/actions
// @Summary Execute action on inbox message
// @Description Execute an action (mark as read, archive, etc.) on an inbox message
// @Tags inbox
// @Accept json
// @Produce json
// @Param id path string true "Message ID"
// @Param action body ExecuteActionRequest true "Action to execute"
// @Success 200 {object} ExecuteActionResponse
// @Failure 400 {object} map[string]string
// @Failure 401 {object} map[string]string
// @Failure 404 {object} map[string]string
// @Failure 500 {object} map[string]string
// @Router /inbox/{id}/actions [post]
func (h *ActionsHandler) ExecuteAction(c *gin.Context) {
	ctx := c.Request.Context()

	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	messageID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid message ID"})
		return
	}

	var req ExecuteActionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.logger.Info("executing action",
		zap.String("command", req.Command),
		zap.String("agent", req.Agent),
		zap.String("message_id", messageID.String()),
		zap.String("user_id", user.ID.String()))

	// Special handling for open_web - just return the URL
	if req.Command == "open_web" {
		if req.URL == nil || *req.URL == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "URL is required for open_web command"})
			return
		}
		c.JSON(http.StatusOK, ExecuteActionResponse{
			Success: true,
			Message: "URL ready to open",
			Result:  *req.URL,
		})
		return
	}

	// Get message to know the source (and verify existence)
	_, err = h.storage.GetInboxMessage(ctx, user.ID, messageID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Message not found"})
		return
	}

	// Convert request to InboxAction
	action := storage.InboxAction{
		Command: req.Command,
		Agent:   req.Agent,
		URL:     req.URL,
		Prompt:  req.Prompt,
	}

	// Convert InboxMessage back to Inbox model for plugin (simplified)
	// Ideally plugin should accept InboxMessage or ID
	// We need the raw Inbox model to get UID, which might not be in InboxMessage struct exposed to API
	// Let's fetch raw model
	var rawInbox storage.Inbox
	if err := h.storage.DB.WithContext(ctx).Where("id = ?", messageID).First(&rawInbox).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Message not found in DB"})
		return
	}

	// Delegate to plugin manager
	if err := h.pluginManager.ExecuteAction(ctx, user.ID, rawInbox.Source, action, rawInbox); err != nil {
		h.logger.Error("failed to execute action",
			zap.Error(err),
			zap.String("command", req.Command),
			zap.String("source", rawInbox.Source))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// If action was mark_as_read, update local DB too (plugin might do it, but good to ensure)
	if req.Command == "mark_as_read" {
		_ = h.storage.MarkAsRead(ctx, user.ID, messageID)
	}

	c.JSON(http.StatusOK, ExecuteActionResponse{
		Success: true,
		Message: "Action executed successfully",
	})
}
