package handlers

import (
	"context"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/sandbox-controller/internal/sandbox"
	"go.uber.org/zap"
)

// Handler holds HTTP handlers for the sandbox controller
type Handler struct {
	manager *sandbox.Manager
	logger  *zap.Logger
}

// NewHandler creates a new handler instance
func NewHandler(manager *sandbox.Manager, logger *zap.Logger) *Handler {
	return &Handler{
		manager: manager,
		logger:  logger,
	}
}

// CreateSandboxRequest represents a request to create a sandbox
type CreateSandboxRequest struct {
	UserID    string `json:"user_id" binding:"required"`
	ProjectID string `json:"project_id"`
}

// CreateSandboxResponse represents the response from creating a sandbox
type CreateSandboxResponse struct {
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
	ProjectID string `json:"project_id"`
	Status    string `json:"status"`
}

// CreateSandbox creates a new sandbox
func (h *Handler) CreateSandbox(c *gin.Context) {
	var req CreateSandboxRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	sb, err := h.manager.CreateSandbox(ctx, req.UserID, req.ProjectID)
	if err != nil {
		h.logger.Error("Failed to create sandbox", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, CreateSandboxResponse{
		ID:        sb.ID,
		UserID:    sb.UserID,
		ProjectID: sb.ProjectID,
		Status:    string(sb.Status),
	})
}

// GetSandbox returns the status of a sandbox
func (h *Handler) GetSandbox(c *gin.Context) {
	id := c.Param("id")

	sb, err := h.manager.GetSandbox(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, sb)
}

// ExecRequest represents a command execution request
type ExecRequest struct {
	Command []string `json:"command" binding:"required"`
	Timeout int      `json:"timeout"` // seconds
	Stream  bool     `json:"stream"`
}

// ExecResponse represents the result of a command execution
type ExecResponse struct {
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	ExitCode int    `json:"exit_code"`
}

// Exec executes a command in the sandbox
func (h *Handler) Exec(c *gin.Context) {
	id := c.Param("id")

	var req ExecRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	timeout := time.Duration(req.Timeout) * time.Second
	if timeout <= 0 {
		timeout = 60 * time.Second
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), timeout+10*time.Second)
	defer cancel()

	// Check if streaming is requested
	if req.Stream {
		reader, err := h.manager.ExecStream(ctx, id, req.Command)
		if err != nil {
			h.logger.Error("Failed to execute command", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer reader.Close()

		// Stream output
		c.Header("Content-Type", "text/plain")
		c.Header("Transfer-Encoding", "chunked")
		c.Stream(func(w io.Writer) bool {
			buf := make([]byte, 1024)
			n, err := reader.Read(buf)
			if n > 0 {
				w.Write(buf[:n])
				return true
			}
			return err == nil
		})
		return
	}

	result, err := h.manager.Exec(ctx, id, req.Command, timeout)
	if err != nil {
		h.logger.Error("Failed to execute command", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, ExecResponse{
		Stdout:   result.Stdout,
		Stderr:   result.Stderr,
		ExitCode: result.ExitCode,
	})
}

// UploadRequest represents a file upload request
type UploadRequest struct {
	Path    string `json:"path" binding:"required"`
	Content string `json:"content" binding:"required"`
}

// Upload uploads a file to the sandbox
func (h *Handler) Upload(c *gin.Context) {
	id := c.Param("id")

	var req UploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	if err := h.manager.Upload(ctx, id, req.Path, []byte(req.Content)); err != nil {
		h.logger.Error("Failed to upload file", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Download downloads a file from the sandbox
func (h *Handler) Download(c *gin.Context) {
	id := c.Param("id")
	path := c.Query("path")
	if path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path query parameter required"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	reader, err := h.manager.Download(ctx, id, path)
	if err != nil {
		h.logger.Error("Failed to download file", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		h.logger.Error("Failed to read file", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Data(http.StatusOK, "application/octet-stream", data)
}

// ListFiles lists files in a directory
func (h *Handler) ListFiles(c *gin.Context) {
	id := c.Param("id")
	path := c.Query("path")
	if path == "" {
		path = "/workspace"
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	files, err := h.manager.ListFiles(ctx, id, path)
	if err != nil {
		h.logger.Error("Failed to list files", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"files": files})
}

// DestroySandbox destroys a sandbox
func (h *Handler) DestroySandbox(c *gin.Context) {
	id := c.Param("id")
	deletePVC := c.Query("delete_pvc") == "true"

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	if err := h.manager.DestroySandbox(ctx, id, deletePVC); err != nil {
		h.logger.Error("Failed to destroy sandbox", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// HealthCheck returns the health status
func (h *Handler) HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "healthy",
		"time":   time.Now().UTC(),
	})
}
