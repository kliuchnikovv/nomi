package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/redis/go-redis/v9"
)

type AgentTasksHandler struct {
	storage *storage.Storage
	redis   *redis.Client
	// workerToken guards the internal reconcile endpoint, mirroring the
	// X-Worker-Token check on /internal/worker (WORKER_TOKEN env var).
	workerToken string
}

func NewAgentTasksHandler(store *storage.Storage, redisClient *redis.Client) *AgentTasksHandler {
	return &AgentTasksHandler{
		storage:     store,
		redis:       redisClient,
		workerToken: os.Getenv("WORKER_TOKEN"),
	}
}

// taskRepo identifies the repository a coding task operates on.
type taskRepo struct {
	Owner string `json:"owner"`
	Repo  string `json:"repo"`
	Ref   string `json:"ref"`
}

type createTaskRequest struct {
	Goal   string `json:"goal" binding:"required"`
	ChatID string `json:"chat_id"`
	// TaskKind selects the task flow: "generic" (default) or "coding" (triggers
	// the code-planning flow in the brain).
	TaskKind string `json:"task_kind"`
	// Repo is the optional target repository for coding tasks (nil otherwise).
	Repo *taskRepo `json:"repo"`
}

// Create starts a background task deterministically (the "Run as task" UI
// action). It persists the task row immediately so the client can open the
// detail view without a race, then publishes a TASK_START frame the Python
// worker picks up to run it. Subsequent runner events update the same row.
func (h *AgentTasksHandler) Create(c *gin.Context) {
	user, err := userFromCtx(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req createTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// A task is attached to a chat. If the client supplies one, it MUST belong
	// to the authenticated user — otherwise the task (and its task_start frame
	// published to chat:request:{chat_id}) would target someone else's chat
	// (IDOR). When none is supplied, mint a fresh chat id for this task.
	chatID := uuid.New()
	if req.ChatID != "" {
		parsed, perr := uuid.Parse(req.ChatID)
		if perr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid chat_id"})
			return
		}
		if _, cerr := h.storage.GetChat(c.Request.Context(), user.ID, parsed); cerr != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "chat not found or not owned by user"})
			return
		}
		chatID = parsed
	}

	task := &storage.AgentTask{
		ID:         uuid.New(),
		UserID:     user.ID,
		ChatID:     chatID,
		Goal:       req.Goal,
		Status:     "planning",
		Background: true, // the "Run as task" action always starts a background task
	}
	if err := h.storage.CreateAgentTask(c.Request.Context(), task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create task"})
		return
	}

	// Publish a TASK_START frame matching what the Python worker expects
	// (RedisSession._spawn_background_task / RedisWorker._start_task_run).
	taskKind := req.TaskKind
	if taskKind == "" {
		taskKind = "generic"
	}
	payloadBody := map[string]any{
		"user_id":    user.ID.String(),
		"chat_id":    chatID.String(),
		"goal":       req.Goal,
		"task_id":    task.ID.String(),
		"agent_type": "nomi",
		"background": true,
		"task_kind":  taskKind,
	}
	// repo is optional and only meaningful for coding tasks; pass it through
	// untouched (no credential lookup) when supplied.
	if req.Repo != nil {
		payloadBody["repo"] = req.Repo
	}
	frame := map[string]any{
		"v":       "1",
		"id":      0,
		"ts":      time.Now().UTC().Format(time.RFC3339),
		"kind":    "signal",
		"op":      "task_start",
		"chat_id": chatID.String(),
		"payload": payloadBody,
	}
	payload, _ := json.Marshal(frame)
	if err := h.redis.Publish(c.Request.Context(), "chat:request:"+chatID.String(), payload).Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start task"})
		return
	}

	c.JSON(http.StatusCreated, task)
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

type clarifyRequest struct {
	RequestID string `json:"request_id"`
	Answer    string `json:"answer"`
}

// Clarify resolves a mid-task clarify_request gate: the runner asked the user a
// question and is blocked reading agent:task:clarify:{id}. Mirrors Approve but
// carries a free-text answer instead of a boolean decision.
func (h *AgentTasksHandler) Clarify(c *gin.Context) {
	id, ok := h.ownedTaskID(c)
	if !ok {
		return
	}

	var req clarifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	payload, _ := json.Marshal(gin.H{"request_id": req.RequestID, "answer": req.Answer})
	if err := h.redis.RPush(c.Request.Context(), "agent:task:clarify:"+id.String(), payload).Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to submit answer"})
		return
	}
	c.Status(http.StatusAccepted)
}

// Stop cancels a running background task. It publishes a STOP frame carrying
// the task_id to the task's chat:request channel; the Python worker cancels the
// matching entry in active_task_runs and the runner emits a "cancelled" event
// (which the AgentTaskListener persists). Idempotent: stopping an already
// finished task is a no-op on the worker side.
func (h *AgentTasksHandler) Stop(c *gin.Context) {
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

	frame := map[string]any{
		"v":       "1",
		"id":      0,
		"ts":      time.Now().UTC().Format(time.RFC3339),
		"kind":    "signal",
		"op":      "stop",
		"chat_id": task.ChatID.String(),
		"payload": map[string]any{
			"task_id": task.ID.String(),
			"chat_id": task.ChatID.String(),
		},
	}
	payload, _ := json.Marshal(frame)
	if err := h.redis.Publish(c.Request.Context(), "chat:request:"+task.ChatID.String(), payload).Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to stop task"})
		return
	}
	c.Status(http.StatusAccepted)
}

// reconcileTask is one entry in the reconcile response. It carries everything
// the worker needs to re-adopt an orphaned task: its recovery cursor
// (current_step/attempt), any pending approval gate, the last persisted event
// seq, and the accumulated user guidance messages.
type reconcileTask struct {
	TaskID          uuid.UUID       `json:"task_id"`
	UserID          uuid.UUID       `json:"user_id"`
	ChatID          uuid.UUID       `json:"chat_id"`
	Goal            string          `json:"goal"`
	Status          string          `json:"status"`
	Plan            json.RawMessage `json:"plan"`
	CurrentStep     int             `json:"current_step"`
	Attempt         int             `json:"attempt"`
	PendingApproval json.RawMessage `json:"pending_approval"`
	LastSeq         int             `json:"last_seq"`
	Guidance        []string        `json:"guidance"`
}

const guidancePrefix = "User guidance: "

// ReconcileUnfinished returns background tasks stuck in a non-terminal state so
// the Python worker can re-adopt them after a crash/restart. Worker-only:
// guarded by the same X-Worker-Token check as /internal/worker.
func (h *AgentTasksHandler) ReconcileUnfinished(c *gin.Context) {
	if h.workerToken != "" && c.GetHeader("X-Worker-Token") != h.workerToken {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid worker token"})
		return
	}

	ctx := c.Request.Context()
	tasks, err := h.storage.ListUnfinishedAgentTasks(ctx, 60*time.Second)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list unfinished tasks"})
		return
	}

	out := make([]reconcileTask, 0, len(tasks))
	for i := range tasks {
		t := &tasks[i]

		lastSeq, err := h.storage.MaxAgentTaskEventSeq(ctx, t.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to compute last_seq"})
			return
		}

		events, err := h.storage.ListAgentTaskEventsByTaskID(ctx, t.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load task events"})
			return
		}
		guidance := extractGuidance(events)

		out = append(out, reconcileTask{
			TaskID:          t.ID,
			UserID:          t.UserID,
			ChatID:          t.ChatID,
			Goal:            t.Goal,
			Status:          t.Status,
			Plan:            json.RawMessage(t.Plan),
			CurrentStep:     t.CurrentStep,
			Attempt:         t.Attempt,
			PendingApproval: json.RawMessage(t.PendingApproval),
			LastSeq:         lastSeq,
			Guidance:        guidance,
		})
	}

	c.JSON(http.StatusOK, gin.H{"tasks": out})
}

// extractGuidance pulls the "message" field of "log" events whose message
// starts with "User guidance: " (the steering messages the runner logged).
func extractGuidance(events []storage.AgentTaskEvent) []string {
	guidance := []string{}
	for i := range events {
		if events[i].Kind != "log" {
			continue
		}
		var p struct {
			Message string `json:"message"`
		}
		if err := json.Unmarshal(events[i].Payload, &p); err != nil {
			continue
		}
		if len(p.Message) >= len(guidancePrefix) && p.Message[:len(guidancePrefix)] == guidancePrefix {
			guidance = append(guidance, p.Message)
		}
	}
	return guidance
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
