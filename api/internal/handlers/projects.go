package handlers

import (
	"bytes"
	"net/http"
	"os"
	"time"

	"encoding/json"

	"github.com/gin-gonic/gin"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/hub"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

type ProjectHandler struct {
	store      *storage.Storage
	logger     *zap.Logger
	llmBaseURL string
	// Helper logic from project_tasks.go
	taskHandler *ProjectTaskHandler
	hub         *hub.Hub
}

func NewProjectHandler(store *storage.Storage, logger *zap.Logger, cfg *config.Config, hub *hub.Hub) *ProjectHandler {
	return &ProjectHandler{
		store:       store,
		logger:      logger.With(zap.String("component", "project_handler")),
		llmBaseURL:  cfg.LLM.BaseURL,
		taskHandler: NewProjectTaskHandler(store, logger, cfg), // Re-use notification logic
		hub:         hub,
	}
}

// --- Project Handlers ---

type CreateProjectRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	Repository  string `json:"repository"`
}

// CreateProject creates a new project
func (h *ProjectHandler) CreateProject(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Repository  string `json:"repository"`
		GithubToken string `json:"github_token"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	project := &storage.Project{
		UserID:      userID,
		Name:        req.Name,
		Description: req.Description,
		Repository:  req.Repository,
		Status:      storage.ProjectStatusReady,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}

	if project.Repository != "" {
		project.Status = storage.ProjectStatusAnalyzing
	}

	if err := h.store.CreateProject(c.Request.Context(), project); err != nil {
		h.logger.Error("failed to create project", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create project"})
		return
	}

	// Trigger repository analysis if provided
	if project.Repository != "" {
		go func() {
			// Call Python backend directly via HTTP
			pythonURL := os.Getenv("LLM_BASE_URL")
			if pythonURL == "" {
				pythonURL = "http://localhost:7777"
			}

			payload := map[string]interface{}{
				"project_id":   project.ID.String(),
				"repository":   project.Repository,
				"github_token": req.GithubToken,
				"user_id":      userID.String(),
			}

			payloadBytes, err := json.Marshal(payload)
			if err != nil {
				h.logger.Error("failed to marshal analyze request", zap.Error(err))
				return
			}

			resp, err := http.Post(pythonURL+"/api/analyze-project", "application/json", bytes.NewBuffer(payloadBytes))
			if err != nil {
				h.logger.Error("failed to trigger project analysis", zap.Error(err))
				return
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				h.logger.Error("project analysis request failed", zap.Int("status", resp.StatusCode))
			} else {
				h.logger.Info("project analysis triggered", zap.String("project_id", project.ID.String()))
			}
		}()
	}

	c.JSON(http.StatusCreated, project)
}

func (h *ProjectHandler) ListProjects(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	projects, err := h.store.GetProjects(c.Request.Context(), userID)
	if err != nil {
		h.logger.Error("failed to list projects", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list projects"})
		return
	}
	c.JSON(http.StatusOK, projects)
}

func (h *ProjectHandler) GetProject(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	project, err := h.store.GetProject(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}

	// Verify ownership
	userID := c.MustGet("userID").(uuid.UUID)
	if project.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	c.JSON(http.StatusOK, project)
}

type UpdateProjectRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Repository  string `json:"repository"`
}

func (h *ProjectHandler) UpdateProject(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	var req UpdateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	project, err := h.store.GetProject(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}

	userID := c.MustGet("userID").(uuid.UUID)
	if project.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	if req.Name != "" {
		project.Name = req.Name
	}
	if req.Description != "" {
		project.Description = req.Description
	}
	if req.Repository != "" {
		project.Repository = req.Repository
	}
	project.UpdatedAt = time.Now().UTC()

	if err := h.store.UpdateProject(c.Request.Context(), project); err != nil {
		h.logger.Error("failed to update project", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update project"})
		return
	}

	c.JSON(http.StatusOK, project)
}

func (h *ProjectHandler) DeleteProject(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	project, err := h.store.GetProject(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}

	userID := c.MustGet("userID").(uuid.UUID)
	if project.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	if err := h.store.DeleteProject(c.Request.Context(), id); err != nil {
		h.logger.Error("failed to delete project", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete project"})
		return
	}

	// Trigger knowledge deletion
	go func() {
		pythonURL := os.Getenv("LLM_BASE_URL")
		if pythonURL == "" {
			pythonURL = "http://localhost:7777"
		}

		payload := map[string]interface{}{
			"user_id": userID.String(),
		}
		payloadBytes, _ := json.Marshal(payload)

		client := &http.Client{Timeout: 10 * time.Second}
		req, err := http.NewRequest("DELETE", pythonURL+"/api/projects/"+id.String(), bytes.NewBuffer(payloadBytes))
		if err != nil {
			h.logger.Error("failed to create delete knowledge request", zap.Error(err))
			return
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			h.logger.Error("failed to trigger knowledge deletion", zap.Error(err))
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			h.logger.Error("knowledge deletion request failed", zap.Int("status", resp.StatusCode))
		} else {
			h.logger.Info("knowledge deletion triggered", zap.String("project_id", id.String()))
		}
	}()

	c.Status(http.StatusNoContent)
}

type UpdateProjectStatusRequest struct {
	Status storage.ProjectStatus `json:"status" binding:"required"`
}

func (h *ProjectHandler) UpdateStatus(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	var req UpdateProjectStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.store.UpdateProjectStatus(c.Request.Context(), id, req.Status); err != nil {
		h.logger.Error("failed to update project status", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update project status"})
		return
	}

	c.Status(http.StatusOK)
}

type ReindexProjectRequest struct {
	GithubToken string `json:"github_token"`
}

func (h *ProjectHandler) ReindexProject(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	project, err := h.store.GetProject(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}

	userID := c.MustGet("userID").(uuid.UUID)
	if project.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	if project.Repository == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Project has no repository to reindex"})
		return
	}

	var req ReindexProjectRequest
	_ = c.ShouldBindJSON(&req) // Optional body

	// Update status to ANALYZING
	if err := h.store.UpdateProjectStatus(c.Request.Context(), id, storage.ProjectStatusAnalyzing); err != nil {
		h.logger.Error("failed to update project status", zap.Error(err))
	}

	// Call Python backend to reindex
	go func() {
		pythonURL := os.Getenv("LLM_BASE_URL")
		if pythonURL == "" {
			pythonURL = "http://localhost:7777"
		}

		payload := map[string]interface{}{
			"repository":   project.Repository,
			"github_token": req.GithubToken,
			"user_id":      userID.String(),
		}

		payloadBytes, err := json.Marshal(payload)
		if err != nil {
			h.logger.Error("failed to marshal reindex request", zap.Error(err))
			return
		}

		resp, err := http.Post(pythonURL+"/api/projects/"+id.String()+"/reindex", "application/json", bytes.NewBuffer(payloadBytes))
		if err != nil {
			h.logger.Error("failed to trigger project reindex", zap.Error(err))
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			h.logger.Error("project reindex request failed", zap.Int("status", resp.StatusCode))
		} else {
			h.logger.Info("project reindex triggered", zap.String("project_id", id.String()))
		}
	}()

	c.JSON(http.StatusOK, gin.H{"status": "started", "project_id": id.String()})
}

// --- Task Handlers ---

type CreateProjectTaskRequest struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	Priority    string `json:"priority"`
}

func (h *ProjectHandler) CreateTask(c *gin.Context) {
	projectID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	var req CreateProjectTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify project exists and belongs to user
	project, err := h.store.GetProject(c.Request.Context(), projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}
	userID := c.MustGet("userID").(uuid.UUID)
	if project.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	task := &storage.ProjectTask{
		UserID:      userID,
		ProjectID:   projectID,
		Title:       req.Title,
		Description: req.Description,
		Priority:    req.Priority,
		Status:      storage.ProjectTaskStatusBacklog,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if task.Priority == "" {
		task.Priority = "medium"
	}

	if err := h.store.CreateProjectTask(c.Request.Context(), task); err != nil {
		h.logger.Error("failed to create task", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create task"})
		return
	}

	c.JSON(http.StatusCreated, task)
}

func (h *ProjectHandler) ListTasks(c *gin.Context) {
	projectID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	// Verify project exists and belongs to user
	project, err := h.store.GetProject(c.Request.Context(), projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}
	userID := c.MustGet("userID").(uuid.UUID)
	if project.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	tasks, err := h.store.GetProjectTasks(c.Request.Context(), projectID)
	if err != nil {
		h.logger.Error("failed to list tasks", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list tasks"})
		return
	}

	c.JSON(http.StatusOK, tasks)
}

func (h *ProjectHandler) GetTask(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	task, err := h.store.GetProjectTask(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}

	userID := c.MustGet("userID").(uuid.UUID)
	if task.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	c.JSON(http.StatusOK, task)
}

type UpdateTaskRequest struct {
	Title       string                 `json:"title"`
	Description string                 `json:"description"`
	Priority    string                 `json:"priority"`
	Artifacts   map[string]interface{} `json:"artifacts"`
}

func (h *ProjectHandler) UpdateTask(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	var req UpdateTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	task, err := h.store.GetProjectTask(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}

	userID := c.MustGet("userID").(uuid.UUID)
	if task.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	if req.Title != "" {
		task.Title = req.Title
	}
	if req.Description != "" {
		task.Description = req.Description
	}
	if req.Priority != "" {
		task.Priority = req.Priority
	}
	if req.Artifacts != nil {
		artifactsBytes, err := json.Marshal(req.Artifacts)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid artifacts JSON"})
			return
		}
		if err := task.Artifacts.Set(artifactsBytes); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process artifacts"})
			return
		}
	}
	task.UpdatedAt = time.Now().UTC()

	if err := h.store.UpdateProjectTask(c.Request.Context(), task); err != nil {
		h.logger.Error("failed to update task", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update task"})
		return
	}

	c.JSON(http.StatusOK, task)
}

func (h *ProjectHandler) DeleteTask(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	task, err := h.store.GetProjectTask(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}

	userID := c.MustGet("userID").(uuid.UUID)
	if task.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	if err := h.store.DeleteProjectTask(c.Request.Context(), id); err != nil {
		h.logger.Error("failed to delete task", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete task"})
		return
	}

	c.Status(http.StatusNoContent)
}
