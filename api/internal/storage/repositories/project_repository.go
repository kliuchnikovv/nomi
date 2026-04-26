package repositories

import (
	"context"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

type ProjectRepository interface {
	Create(ctx context.Context, userID uuid.UUID, name, description, icon string) (*storage.Project, error)
	List(ctx context.Context, userID uuid.UUID) ([]storage.Project, error)
	Get(ctx context.Context, userID, projectID uuid.UUID) (*storage.Project, error)
	Update(ctx context.Context, userID, projectID uuid.UUID, name, description, icon string) (*storage.Project, error)
	Delete(ctx context.Context, userID, projectID uuid.UUID) error
	CountChats(ctx context.Context, userID, projectID uuid.UUID) (int64, error)
}

func NewProjectRepository(store *storage.Storage) ProjectRepository {
	return &projectRepository{store: store}
}

type projectRepository struct {
	store *storage.Storage
}

func (r *projectRepository) Create(ctx context.Context, userID uuid.UUID, name, description, icon string) (*storage.Project, error) {
	return r.store.CreateProject(ctx, userID, name, description, icon)
}

func (r *projectRepository) List(ctx context.Context, userID uuid.UUID) ([]storage.Project, error) {
	return r.store.GetUserProjects(ctx, userID)
}

func (r *projectRepository) Get(ctx context.Context, userID, projectID uuid.UUID) (*storage.Project, error) {
	return r.store.GetProject(ctx, userID, projectID)
}

func (r *projectRepository) Update(ctx context.Context, userID, projectID uuid.UUID, name, description, icon string) (*storage.Project, error) {
	return r.store.UpdateProject(ctx, userID, projectID, name, description, icon)
}

func (r *projectRepository) Delete(ctx context.Context, userID, projectID uuid.UUID) error {
	return r.store.DeleteProject(ctx, userID, projectID)
}

func (r *projectRepository) CountChats(ctx context.Context, userID, projectID uuid.UUID) (int64, error) {
	return r.store.CountChatsInProject(ctx, userID, projectID)
}
