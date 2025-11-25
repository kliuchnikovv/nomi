package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/actions"
	"github.com/kliuchnikovv/genie-api/internal/llm"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

type ActionsHandler struct {
	storage    *storage.Storage
	llmService *llm.Service
	logger     *zap.Logger
	executor   *actions.Executor
}

func NewActionsHandler(storage *storage.Storage, llmService *llm.Service, logger *zap.Logger) *ActionsHandler {
	return &ActionsHandler{
		storage:    storage,
		llmService: llmService,
		logger:     logger.With(zap.String("component", "actions_handler")),
		executor:   actions.NewExecutor(logger, storage),
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

	// Convert request to InboxAction
	action := storage.InboxAction{
		Command: req.Command,
		Agent:   req.Agent,
		URL:     req.URL,
		Prompt:  req.Prompt,
	}

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

	// Execute the action using ActionExecutor
	if err := h.executor.Execute(ctx, user.ID, messageID, action); err != nil {
		h.logger.Error("failed to execute action",
			zap.Error(err),
			zap.String("command", req.Command),
			zap.String("message_id", messageID.String()))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, ExecuteActionResponse{
		Success: true,
		Message: "Action executed successfully",
	})
}
