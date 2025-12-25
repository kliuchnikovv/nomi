package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
	"gorm.io/datatypes"
)

type CreateTaskRequest struct {
	UserID   uuid.UUID       `json:"user_id"`
	ChatID   uuid.UUID       `json:"chat_id"`
	Message  string          `json:"message"`
	Tools    json.RawMessage `json:"tools"`     // Tool specifications from agent creation time
	Time     string          `json:"time"`      // ISO 8601 or similar
	Cron     string          `json:"cron"`      // Optional
	DelaySec int             `json:"delay_sec"` // Optional, if time is not set
}

func (h *Handler) CreateTask(w http.ResponseWriter, r *http.Request) {
	var req CreateTaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// Validate fields
	// If UserID is missing, it might be filled from Context if we use AuthMiddleware
	// But the Tool might send it.

	// In the real world, the AuthMiddleware puts user in context.
	// But let's assume the caller provides it for now or we trust the token.

	if req.ChatID == uuid.Nil || req.Message == "" {
		http.Error(w, "missing required fields", http.StatusBadRequest)
		return
	}

	// Calculate ExecuteAt
	var executeAt time.Time
	if req.Time != "" {
		parsed, err := time.Parse(time.RFC3339, req.Time)
		if err != nil {
			// Try without Z
			parsed, err = time.Parse("2006-01-02T15:04:05", req.Time)
			if err != nil {
				http.Error(w, "invalid time format (use RFC3339)", http.StatusBadRequest)
				return
			}
		}
		executeAt = parsed
	} else if req.DelaySec > 0 {
		executeAt = time.Now().UTC().Add(time.Duration(req.DelaySec) * time.Second)
	} else {
		executeAt = time.Now().UTC()
	}

	// Create Payload
	payloadMap := map[string]interface{}{
		"message": req.Message,
	}
	payloadBytes, _ := json.Marshal(payloadMap)

	task := &storage.Task{
		UserID:    req.UserID,
		ChatID:    req.ChatID,
		Type:      "agent_message",
		Payload:   datatypes.JSON(payloadBytes),
		Tools:     datatypes.JSON(req.Tools), // Save tools from creation time
		CronExpr:  req.Cron,
		ExecuteAt: executeAt,
		Status:    storage.TaskStatusPending,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}

	if err := h.Store.CreateTask(r.Context(), task); err != nil {
		h.Logger.Error("failed to create task", zap.Error(err))
		http.Error(w, "failed to create task", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"task_id": task.ID,
		"status":  "created",
	})
}
