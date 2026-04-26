package handlers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/apierror"
	"github.com/kliuchnikovv/genie-api/internal/services"
	"gorm.io/gorm"
)

type ProjectHandler struct {
	service *services.ProjectService
}

func NewProjectHandler(service *services.ProjectService) *ProjectHandler {
	return &ProjectHandler{service: service}
}

func (h *ProjectHandler) ListProjects(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		apierror.Respond(c, apierror.NewUnauthorized(err.Error()))
		return
	}
	projects, err := h.service.List(ctx, user.ID)
	if err != nil {
		apierror.Respond(c, apierror.NewInternalServerError(err.Error()))
		return
	}
	c.JSON(http.StatusOK, projects)
}

func (h *ProjectHandler) CreateProject(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		apierror.Respond(c, apierror.NewUnauthorized(err.Error()))
		return
	}
	var req services.CreateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		apierror.Respond(c, apierror.NewBadRequest(err.Error(), nil))
		return
	}
	project, err := h.service.Create(ctx, user.ID, &req)
	if err != nil {
		apierror.Respond(c, apierror.NewInternalServerError(err.Error()))
		return
	}
	c.JSON(http.StatusOK, project)
}

func (h *ProjectHandler) UpdateProject(c *gin.Context) {
	ctx := c.Request.Context()
	projectID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		apierror.Respond(c, apierror.NewBadRequest("Invalid UUID", nil))
		return
	}
	user, err := userFromCtx(ctx)
	if err != nil {
		apierror.Respond(c, apierror.NewUnauthorized(err.Error()))
		return
	}
	var req services.UpdateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		apierror.Respond(c, apierror.NewBadRequest(err.Error(), nil))
		return
	}
	project, err := h.service.Update(ctx, user.ID, projectID, &req)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			apierror.Respond(c, apierror.NewNotFound("Project not found"))
			return
		}
		apierror.Respond(c, apierror.NewInternalServerError(err.Error()))
		return
	}
	c.JSON(http.StatusOK, project)
}

func (h *ProjectHandler) DeleteProject(c *gin.Context) {
	ctx := c.Request.Context()
	projectID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		apierror.Respond(c, apierror.NewBadRequest("Invalid UUID", nil))
		return
	}
	user, err := userFromCtx(ctx)
	if err != nil {
		apierror.Respond(c, apierror.NewUnauthorized(err.Error()))
		return
	}
	if err := h.service.Delete(ctx, user.ID, projectID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			apierror.Respond(c, apierror.NewNotFound("Project not found"))
			return
		}
		apierror.Respond(c, apierror.NewInternalServerError(err.Error()))
		return
	}
	c.JSON(http.StatusNoContent, nil)
}
