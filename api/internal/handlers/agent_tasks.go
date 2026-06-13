package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

type AgentTasksHandler struct {
	storage *storage.Storage
}

func NewAgentTasksHandler(store *storage.Storage) *AgentTasksHandler {
	return &AgentTasksHandler{storage: store}
}

// List returns the authenticated user's agent tasks (most recent first).
func (h *AgentTasksHandler) List(c *gin.Context) {
	user, err := userFromCtx(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	tasks, err := h.storage.ListAgentTasksForUser(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list tasks"})
		return
	}

	c.JSON(http.StatusOK, tasks)
}

// Get returns a single task plus its ordered event log.
func (h *AgentTasksHandler) Get(c *gin.Context) {
	user, err := userFromCtx(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	task, err := h.storage.GetAgentTask(c.Request.Context(), id, user.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}

	events, err := h.storage.ListAgentTaskEvents(c.Request.Context(), id, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load task events"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"task": task, "events": events})
}
