package storage

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgtype"
	"gorm.io/gorm"
)

// ProjectTaskStatus defines the state of a project task
type ProjectTaskStatus string

const (
	ProjectTaskStatusBacklog  ProjectTaskStatus = "BACKLOG"
	ProjectTaskStatusAnalysis ProjectTaskStatus = "ANALYSIS"
	ProjectTaskStatusPlanning ProjectTaskStatus = "PLANNING"
	ProjectTaskStatusCoding   ProjectTaskStatus = "CODING"
	ProjectTaskStatusReview   ProjectTaskStatus = "REVIEW"
	ProjectTaskStatusVerify   ProjectTaskStatus = "VERIFY"
	ProjectTaskStatusDone     ProjectTaskStatus = "DONE"
	ProjectTaskStatusCancelled ProjectTaskStatus = "CANCELLED"
)

// Project represents a project context
type Project struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID      uuid.UUID      `gorm:"type:uuid;not null;index"`
	Name        string         `gorm:"type:text;not null"`
	Description string         `gorm:"type:text"`
	Repository  string         `gorm:"type:text"` // e.g. "owner/repo"
	CreatedAt   time.Time      `gorm:"not null"`
	UpdatedAt   time.Time      `gorm:"not null"`
	DeletedAt   gorm.DeletedAt `gorm:"index"`
}

// ProjectTask represents a task within a project
type ProjectTask struct {
	ID          uuid.UUID         `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID      uuid.UUID         `gorm:"type:uuid;not null;index"`
	ProjectID   uuid.UUID         `gorm:"type:uuid;not null;index"`
	Title       string            `gorm:"type:text;not null"`
	Description string            `gorm:"type:text"`
	Status      ProjectTaskStatus `gorm:"type:varchar(20);default:'BACKLOG';not null"`
	Priority    string            `gorm:"type:varchar(20);default:'medium'"`
	Artifacts   pgtype.JSONB      `gorm:"type:jsonb;default:'{}'"` // AnalystOutput + ArchitectPlan
	CreatedAt   time.Time         `gorm:"not null"`
	UpdatedAt   time.Time         `gorm:"not null"`
	DeletedAt   gorm.DeletedAt    `gorm:"index"`
}

// CreateProject creates a new project
func (s *Storage) CreateProject(ctx context.Context, project *Project) error {
	return s.DB.WithContext(ctx).Create(project).Error
}

// CreateProjectTask creates a new project task
func (s *Storage) CreateProjectTask(ctx context.Context, task *ProjectTask) error {
	return s.DB.WithContext(ctx).Create(task).Error
}

// GetProjectTask retrieves a task by ID
func (s *Storage) GetProjectTask(ctx context.Context, id uuid.UUID) (*ProjectTask, error) {
	var task ProjectTask
	if err := s.DB.WithContext(ctx).First(&task, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &task, nil
}

// UpdateProjectTaskStatus updates the status of a project task
func (s *Storage) UpdateProjectTaskStatus(ctx context.Context, id uuid.UUID, status ProjectTaskStatus) error {
	result := s.DB.WithContext(ctx).Model(&ProjectTask{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status":     status,
		"updated_at": time.Now().UTC(),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("task not found")
	}
	return nil
}

// GetProjects retrieves all projects for a user
func (s *Storage) GetProjects(ctx context.Context, userID uuid.UUID) ([]Project, error) {
	var projects []Project
	if err := s.DB.WithContext(ctx).Where("user_id = ?", userID).Find(&projects).Error; err != nil {
		return nil, err
	}
	return projects, nil
}

// GetProject retrieves a project by ID
func (s *Storage) GetProject(ctx context.Context, id uuid.UUID) (*Project, error) {
	var project Project
	if err := s.DB.WithContext(ctx).First(&project, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &project, nil
}

// UpdateProject updates a project
func (s *Storage) UpdateProject(ctx context.Context, project *Project) error {
	return s.DB.WithContext(ctx).Save(project).Error
}

// DeleteProject deletes a project (soft delete)
func (s *Storage) DeleteProject(ctx context.Context, id uuid.UUID) error {
	return s.DB.WithContext(ctx).Delete(&Project{}, id).Error
}

// GetProjectTasks retrieves all tasks for a project
func (s *Storage) GetProjectTasks(ctx context.Context, projectID uuid.UUID) ([]ProjectTask, error) {
	var tasks []ProjectTask
	if err := s.DB.WithContext(ctx).Where("project_id = ?", projectID).Find(&tasks).Error; err != nil {
		return nil, err
	}
	return tasks, nil
}

// UpdateProjectTask updates a project task
func (s *Storage) UpdateProjectTask(ctx context.Context, task *ProjectTask) error {
	return s.DB.WithContext(ctx).Save(task).Error
}

// DeleteProjectTask deletes a project task (soft delete)
func (s *Storage) DeleteProjectTask(ctx context.Context, id uuid.UUID) error {
	return s.DB.WithContext(ctx).Delete(&ProjectTask{}, id).Error
}
