package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/redis/go-redis/v9"
)

type AgentTasksHandler struct {
	storage *storage.Storage
	redis   *redis.Client
}

func NewAgentTasksHandler(store *storage.Storage, redisClient *redis.Client) *AgentTasksHandler {
	return &AgentTasksHandler{storage: store, redis: redisClient}
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

type steerRequest struct {
	Message string `json:"message" binding:"required"`
}

// Steer pushes a mid-task guidance message the runner absorbs before its next
// step (Redis list agent:task:steer:{id}).
func (h *AgentTasksHandler) Steer(c *gin.Context) {
	id, ok := h.ownedTaskID(c)
	if !ok {
		return
	}

	var req steerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	payload, _ := json.Marshal(gin.H{"message": req.Message})
	if err := h.redis.RPush(c.Request.Context(), "agent:task:steer:"+id.String(), payload).Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to queue steering message"})
		return
	}
	c.Status(http.StatusAccepted)
}

type approveRequest struct {
	RequestID string `json:"request_id"`
	Approved  bool   `json:"approved"`
}

// Approve resolves a pending approval gate (Redis list agent:task:approval:{id}).
func (h *AgentTasksHandler) Approve(c *gin.Context) {
	id, ok := h.ownedTaskID(c)
	if !ok {
		return
	}

	var req approveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	payload, _ := json.Marshal(gin.H{"request_id": req.RequestID, "approved": req.Approved})
	if err := h.redis.RPush(c.Request.Context(), "agent:task:approval:"+id.String(), payload).Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to submit decision"})
		return
	}
	c.Status(http.StatusAccepted)
}

// ownedTaskID parses :id and verifies it belongs to the authenticated user,
// writing the appropriate error response and returning ok=false otherwise.
func (h *AgentTasksHandler) ownedTaskID(c *gin.Context) (uuid.UUID, bool) {
	user, err := userFromCtx(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return uuid.Nil, false
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return uuid.Nil, false
	}
	if _, err := h.storage.GetAgentTask(c.Request.Context(), id, user.ID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return uuid.Nil, false
	}
	return id, true
}
