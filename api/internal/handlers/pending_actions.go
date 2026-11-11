package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"gorm.io/datatypes"

	"github.com/kliuchnikovv/nomi-api/internal/storage"
)

// EnqueuePendingActionRequest is the body for the internal enqueue endpoint,
// called by the Python brain when it cannot reach a connected device.
type EnqueuePendingActionRequest struct {
	UserID          string          `json:"user_id" binding:"required"`
	Source          string          `json:"source" binding:"required"`
	DeliveryContext json.RawMessage `json:"delivery_context"`
	SessionID       string          `json:"session_id" binding:"required"`
	CallID          string          `json:"call_id" binding:"required"`
	Tool            string          `json:"tool" binding:"required"`
	Method          string          `json:"method" binding:"required"`
	Params          json.RawMessage `json:"params"`
	IntegrationID   string          `json:"integration_id"`
	ExpiresAt       *time.Time      `json:"expires_at"`
}

// EnqueuePendingAction persists a queued client action and immediately sends a
// silent wake push so a backgrounded device can come online and drain it.
// Internal endpoint (no auth; trusted server-to-server like /api/tools).
func (h *StreamHandler) EnqueuePendingAction(c *gin.Context) {
	ctx := c.Request.Context()

	var req EnqueuePendingActionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body: " + err.Error()})
		return
	}

	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id"})
		return
	}

	action := &storage.PendingClientAction{
		UserID:    userID,
		Source:    req.Source,
		SessionID: req.SessionID,
		CallID:    req.CallID,
		Tool:      req.Tool,
		Method:    req.Method,
		Status:    "pending",
		ExpiresAt: req.ExpiresAt,
	}
	if len(req.DeliveryContext) > 0 {
		action.DeliveryContext = datatypes.JSON(req.DeliveryContext)
	}
	if len(req.Params) > 0 {
		action.Params = datatypes.JSON(req.Params)
	}
	if req.IntegrationID != "" {
		action.IntegrationID = &req.IntegrationID
	}

	if _, err := h.store.EnqueuePendingAction(ctx, action); err != nil {
		h.logger.Error("[PendingActions] enqueue failed", zap.String("call_id", req.CallID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to enqueue"})
		return
	}

	// Wake the device so it can connect and drain. Best-effort: a delivery
	// failure (e.g. no registered device) must not fail the enqueue.
	if err := h.push.WakeDevice(ctx, userID); err != nil {
		h.logger.Warn("[PendingActions] wake push failed", zap.String("user_id", userID.String()), zap.Error(err))
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// FinalizePendingActionRequest is the body for the internal finalize endpoint.
type FinalizePendingActionRequest struct {
	CallID string `json:"call_id" binding:"required"`
	Status string `json:"status"` // defaults to "done"
	Result string `json:"result"`
}

// FinalizePendingAction marks a queued action as resolved. Called by the brain
// when it received the result in time (so the device must not re-drain it).
// Internal endpoint.
func (h *StreamHandler) FinalizePendingAction(c *gin.Context) {
	ctx := c.Request.Context()

	var req FinalizePendingActionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body: " + err.Error()})
		return
	}
	status := req.Status
	if status == "" {
		status = "done"
	}

	if _, err := h.store.MarkPendingActionResult(ctx, req.CallID, status, req.Result); err != nil {
		h.logger.Error("[PendingActions] finalize failed", zap.String("call_id", req.CallID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to finalize"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// PendingActionDTO is the device-facing shape of a queued action.
type PendingActionDTO struct {
	CallID        string          `json:"call_id"`
	SessionID     string          `json:"session_id"`
	Tool          string          `json:"tool"`
	Method        string          `json:"method"`
	Params        json.RawMessage `json:"params"`
	IntegrationID string          `json:"integration_id,omitempty"`
}

// ListPendingActions returns the authenticated user's queued actions so the
// device can drain them. Authenticated (device) endpoint.
func (h *StreamHandler) ListPendingActions(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	actions, err := h.store.ListPendingActionsForUser(ctx, user.ID)
	if err != nil {
		h.logger.Error("[PendingActions] list failed", zap.String("user_id", user.ID.String()), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list"})
		return
	}

	out := make([]PendingActionDTO, 0, len(actions))
	for _, a := range actions {
		dto := PendingActionDTO{
			CallID:    a.CallID,
			SessionID: a.SessionID,
			Tool:      a.Tool,
			Method:    a.Method,
			Params:    json.RawMessage(a.Params),
		}
		if a.IntegrationID != nil {
			dto.IntegrationID = *a.IntegrationID
		}
		out = append(out, dto)
	}
	c.JSON(http.StatusOK, gin.H{"actions": out})
}

// PendingActionResultRequest is the body the device posts after executing a
// drained action.
type PendingActionResultRequest struct {
	CallID string `json:"call_id" binding:"required"`
	Result string `json:"result"`
}

// PendingActionResult records the result of a drained queued action and, if the
// action was still pending (i.e. the originating brain run already ended),
// publishes a deferred-result event so Python can send a follow-up message on
// the originating channel. Authenticated (device) endpoint.
func (h *StreamHandler) PendingActionResult(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req PendingActionResultRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body: " + err.Error()})
		return
	}

	// Fetch first so we have the delivery context for the follow-up.
	action, err := h.store.GetPendingActionByCallID(ctx, req.CallID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "action not found"})
		return
	}
	// Guard: a device may only resolve its own actions.
	if action.UserID != user.ID {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	rows, err := h.store.MarkPendingActionResult(ctx, req.CallID, "done", req.Result)
	if err != nil {
		h.logger.Error("[PendingActions] mark result failed", zap.String("call_id", req.CallID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record result"})
		return
	}

	// Only publish a follow-up if THIS call transitioned the row from pending
	// (rows>0). If rows==0 it was already finalized (e.g. the brain handled the
	// live result), so no follow-up is needed.
	if rows > 0 {
		if err := h.hub.PublishDeferredActionResult(ctx, action.Source, action.SessionID, req.CallID, req.Result, action.DeliveryContext); err != nil {
			h.logger.Warn("[PendingActions] publish deferred result failed", zap.String("call_id", req.CallID), zap.Error(err))
		}
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}
