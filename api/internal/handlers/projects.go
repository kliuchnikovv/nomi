package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

type ProjectHandler struct {
	store      *storage.Storage
	logger     *zap.Logger
	llmBaseURL string
	// Helper logic from project_tasks.go
	taskHandler *ProjectTaskHandler
}

func NewProjectHandler(store *storage.Storage, logger *zap.Logger, cfg *config.Config) *ProjectHandler {
	return &ProjectHandler{
		store:       store,
		logger:      logger.With(zap.String("component", "project_handler")),
		llmBaseURL:  cfg.LLM.BaseURL,
		taskHandler: NewProjectTaskHandler(store, logger, cfg), // Re-use notification logic
	}
}

// --- Project Handlers ---

type CreateProjectRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	Repository  string `json:"repository"`
}

func (h *ProjectHandler) CreateProject(c *gin.Context) {
	var req CreateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.MustGet("userID").(uuid.UUID)
	project := &storage.Project{
		UserID:      userID,
		Name:        req.Name,
		Description: req.Description,
		Repository:  req.Repository,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}

	if err := h.store.CreateProject(c.Request.Context(), project); err != nil {
		h.logger.Error("failed to create project", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create project"})
		return
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

	c.Status(http.StatusNoContent)
}

// --- Task Handlers ---

type CreateTaskRequest struct {
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

	var req CreateTaskRequest
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
	Title       string `json:"title"`
	Description string `json:"description"`
	Priority    string `json:"priority"`
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

// Delegate UpdateStatus to the existing logic, or re-implement here?
// Since `project_tasks.go` already has the logic with state machine and notification,
// I can just reuse `h.taskHandler.UpdateStatus` if I expose it or just wrap it.
//
// Alternatively, I can move the logic here.
// For now, I'll let the router use `taskHandler.UpdateStatus` for that specific endpoint,
// effectively keeping the "Project Handler" focused on CRUD.
