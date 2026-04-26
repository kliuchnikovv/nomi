package services

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/kliuchnikovv/genie-api/internal/storage/repositories"
)

type ProjectService struct {
	repo repositories.ProjectRepository
}

func NewProjectService(repo repositories.ProjectRepository) *ProjectService {
	return &ProjectService{repo: repo}
}

type ProjectResponse struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Icon        string    `json:"icon"`
	ChatCount   int64     `json:"chat_count"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type CreateProjectRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
}

type UpdateProjectRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
}

func (s *ProjectService) toResponse(ctx context.Context, userID uuid.UUID, p *storage.Project) (*ProjectResponse, error) {
	count, err := s.repo.CountChats(ctx, userID, p.ID)
	if err != nil {
		return nil, err
	}
	return &ProjectResponse{
		ID:          p.ID,
		Name:        p.Name,
		Description: p.Description,
		Icon:        p.Icon,
		ChatCount:   count,
		CreatedAt:   p.CreatedAt,
		UpdatedAt:   p.UpdatedAt,
	}, nil
}

func (s *ProjectService) Create(ctx context.Context, userID uuid.UUID, req *CreateProjectRequest) (*ProjectResponse, error) {
	icon := req.Icon
	if icon == "" {
		icon = "📁"
	}
	p, err := s.repo.Create(ctx, userID, req.Name, req.Description, icon)
	if err != nil {
		return nil, err
	}
	return s.toResponse(ctx, userID, p)
}

func (s *ProjectService) List(ctx context.Context, userID uuid.UUID) ([]*ProjectResponse, error) {
	projects, err := s.repo.List(ctx, userID)
	if err != nil {
		return nil, err
	}
	result := make([]*ProjectResponse, len(projects))
	for i := range projects {
		resp, err := s.toResponse(ctx, userID, &projects[i])
		if err != nil {
			return nil, err
		}
		result[i] = resp
	}
	return result, nil
}

func (s *ProjectService) Update(ctx context.Context, userID, projectID uuid.UUID, req *UpdateProjectRequest) (*ProjectResponse, error) {
	icon := req.Icon
	if icon == "" {
		icon = "📁"
	}
	p, err := s.repo.Update(ctx, userID, projectID, req.Name, req.Description, icon)
	if err != nil {
		return nil, err
	}
	return s.toResponse(ctx, userID, p)
}

func (s *ProjectService) Delete(ctx context.Context, userID, projectID uuid.UUID) error {
	return s.repo.Delete(ctx, userID, projectID)
}
