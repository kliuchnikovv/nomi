package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/hub"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

type ProjectTaskHandler struct {
	store      *storage.Storage
	logger     *zap.Logger
	llmBaseURL string
	hub        *hub.Hub
}

func NewProjectTaskHandler(store *storage.Storage, logger *zap.Logger, cfg *config.Config, hub *hub.Hub) *ProjectTaskHandler {
	baseURL := cfg.LLM.BaseURL
	if baseURL == "" {
		baseURL = "http://127.0.0.1:7777"
	}
	return &ProjectTaskHandler{
		store:      store,
		logger:     logger.With(zap.String("component", "project_task_handler")),
		llmBaseURL: baseURL,
		hub:        hub,
	}
}

type UpdateStatusRequest struct {
	Status    storage.ProjectTaskStatus `json:"status" binding:"required"`
	Artifacts map[string]interface{}    `json:"artifacts"`
}

func (h *ProjectTaskHandler) UpdateStatus(c *gin.Context) {
	taskIDStr := c.Param("id")
	taskID, err := uuid.Parse(taskIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	var req UpdateStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Fetch existing task to validate transition
	task, err := h.store.GetProjectTask(c.Request.Context(), taskID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}

	// Validate State Machine Transitions
	if !isValidTransition(task.Status, req.Status) {
		c.JSON(http.StatusConflict, gin.H{
			"error": fmt.Sprintf("Invalid status transition from %s to %s", task.Status, req.Status),
		})
		return
	}

	// Prepare artifacts
	var artifactsBytes []byte
	if req.Artifacts != nil {
		b, err := json.Marshal(req.Artifacts)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid artifacts JSON"})
			return
		}
		artifactsBytes = b
	}

	// Update status and artifacts
	if err := h.store.UpdateProjectTaskStatus(c.Request.Context(), taskID, req.Status, artifactsBytes); err != nil {
		h.logger.Error("failed to update task status", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update status"})
		return
	}

	// Notify Python Backend (Team Lead Agent)
	go h.notifyTeamLead(task.UserID, task.ProjectID, task.ID, task.Status, req.Status)

	// Broadcast task_updated event to Project Room
	h.hub.BroadcastToRoom(task.ProjectID, hub.Frame{
		ID:        0, // System frame
		ChatID:    task.ProjectID,
		Kind:      hub.MetaKind,
		Operation: hub.MessageOperation,
		Timestamp: time.Now().UTC(),
		Payload: hub.Payload{
			Type:    "task_updated",
			Message: string(req.Status),
			Params: map[string]interface{}{
				"task_id":    task.ID.String(),
				"old_status": task.Status,
				"new_status": req.Status,
				"artifacts":  req.Artifacts,
			},
		},
	})

	c.JSON(http.StatusOK, gin.H{
		"id":         task.ID,
		"old_status": task.Status,
		"new_status": req.Status,
	})
}

func isValidTransition(current, next storage.ProjectTaskStatus) bool {
	// If status is not changing, it's valid (idempotent)
	if current == next {
		return true
	}

	// Always allow cancelling
	if next == storage.ProjectTaskStatusCancelled {
		return true
	}

	// Always allow going back to ANALYSIS (changing requirements)
	if next == storage.ProjectTaskStatusAnalysis {
		return true
	}

	switch current {
	case storage.ProjectTaskStatusBacklog:
		return next == storage.ProjectTaskStatusAnalysis
	case storage.ProjectTaskStatusAnalysis:
		return next == storage.ProjectTaskStatusCoding
	case storage.ProjectTaskStatusCoding:
		return next == storage.ProjectTaskStatusReview
	case storage.ProjectTaskStatusReview:
		return next == storage.ProjectTaskStatusDone || next == storage.ProjectTaskStatusCoding // Done or Fixes
	case storage.ProjectTaskStatusDone:
		return false // Terminal state (except analysis/cancelled handled above)
	case storage.ProjectTaskStatusCancelled:
		return false // Terminal state (except analysis handled above - can we revive? Assuming yes via Analysis)
	default:
		return false
	}
}

type NotificationPayload struct {
	UserID    uuid.UUID                 `json:"user_id"`
	ProjectID uuid.UUID                 `json:"project_id"`
	TaskID    uuid.UUID                 `json:"task_id"`
	OldStatus storage.ProjectTaskStatus `json:"old_status"`
	NewStatus storage.ProjectTaskStatus `json:"new_status"`
	Timestamp time.Time                 `json:"timestamp"`
}

func (h *ProjectTaskHandler) notifyTeamLead(userID, projectID, taskID uuid.UUID, oldStatus, newStatus storage.ProjectTaskStatus) {
	payload := NotificationPayload{
		UserID:    userID,
		ProjectID: projectID,
		TaskID:    taskID,
		OldStatus: oldStatus,
		NewStatus: newStatus,
		Timestamp: time.Now().UTC(),
	}

	body, err := json.Marshal(payload)
	if err != nil {
		h.logger.Error("failed to marshal notification payload", zap.Error(err))
		return
	}

	url := fmt.Sprintf("%s/api/notify-lead", h.llmBaseURL)
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(body))
	if err != nil {
		h.logger.Error("failed to create notification request", zap.Error(err))
		return
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		h.logger.Error("failed to send notification to team lead", zap.Error(err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		h.logger.Error("team lead notification failed", zap.Int("status", resp.StatusCode))
	} else {
		h.logger.Info("team lead notified",
			zap.String("task_id", taskID.String()),
			zap.String("status", string(newStatus)))
	}
}
