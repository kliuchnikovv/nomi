package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgtype"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// Chat представляет чат в базе данных
type Chat struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index:idx_chats_user_updated,priority:1"`
	Model  string    `gorm:"type:text;not null"`
	Title  string    `gorm:"not null"`
	Mode   string    `gorm:"type:varchar(20);not null;default:'agent'"` // 'agent' or 'team'

	TeamID     *string    `gorm:"type:varchar(50);default:null"` // e.g. 'dnd_team', 'travel_planning'
	ProjectID  *uuid.UUID `gorm:"type:uuid;default:null;index"`
	TaskID     *uuid.UUID `gorm:"type:uuid;default:null;index"`
	CreatedAt  time.Time  `gorm:"not null"`
	UpdatedAt  time.Time  `gorm:"not null;index;index:idx_chats_user_updated,priority:2,sort:desc"`
	ArchivedAt *time.Time `gorm:"default:null"`
	DeletedAt  gorm.DeletedAt
}

// Attachment represents a file attachment in the database
type Attachment struct {
	ID        uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	MessageID *uuid.UUID `gorm:"type:uuid;index;default:null"` // Nullable, linked when message is sent
	UserID    uuid.UUID  `gorm:"type:uuid;not null;index"`
	FileName  string     `gorm:"type:text;not null"`
	FileType  string     `gorm:"type:text;not null"`
	Size      int64      `gorm:"type:bigint;not null"`
	Content   []byte     `gorm:"type:bytea;not null"` // Store content directly in DB
	CreatedAt time.Time  `gorm:"not null"`
}

// Message represents a message in the database
type Message struct {
	ID           uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	ChatID       uuid.UUID      `gorm:"type:uuid;not null;index:idx_messages_chat_created,priority:1"`
	UserID       uuid.UUID      `gorm:"type:uuid;not null"`
	Role         string         `gorm:"type:varchar(20);not null"`
	Text         string         `gorm:"type:text;not null"`
	AgentID      *string        `gorm:"type:varchar(50);default:null;index"` // For multi-agent teams
	ToolCalls    datatypes.JSON `gorm:"type:jsonb"`
	ContentParts datatypes.JSON `gorm:"type:jsonb"` // Stores ordered text, tool_calls, reasoning
	Reasoning    string         `gorm:"type:text"`  // Stores accumulated reasoning/thinking steps
	Model        string         `gorm:"type:text"`
	Actions      datatypes.JSON `gorm:"type:jsonb"` // Stores potential user actions (buttons)
	Attachments  []Attachment   `gorm:"foreignKey:MessageID"`
	CreatedAt    time.Time      `gorm:"not null;index:idx_messages_chat_created,priority:2,sort:desc"`
	UpdatedAt    time.Time      `gorm:"not null"`
}

type Integration struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID    uuid.UUID `gorm:"type:uuid;not null"`
	Name      string    `gorm:"type:text;not null"`
	Provider  string    `gorm:"type:text;not null"`
	Params    string    `gorm:"type:text;not null"`
	Enabled   bool      `gorm:"default:true;not null"`
	CreatedAt time.Time `gorm:"not null"`
	UpdatedAt time.Time `gorm:"not null"`
}

type Inbox struct {
	ID            uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID        uuid.UUID      `gorm:"type:uuid;not null"`
	IntegrationID uuid.UUID      `gorm:"type:uuid;not null"`
	Source        string         `gorm:"type:varchar(50);not null;default:'gmail'"`
	MessageID     string         `gorm:"type:text"`
	UID           uint32         `gorm:"type:integer"`
	ThreadID      uint64         `gorm:"type:bigint"`
	Sender        string         `gorm:"type:text"`
	Role          string         `gorm:"type:varchar(20);not null;default:'user'"`
	Header        string         `gorm:"type:text;not null"`
	Content       string         `gorm:"type:text;not null"`
	Summary       string         `gorm:"type:text"`
	Importance    string         `gorm:"type:varchar(50)"`
	Actions       datatypes.JSON `gorm:"type:jsonb"`
	Metadata      datatypes.JSON `gorm:"type:jsonb"`
	Status        string         `gorm:"type:varchar(20);default:'pending';not null"`
	ReceivedAt    time.Time      `gorm:"not null"`
	CreatedAt     time.Time      `gorm:"not null"`
	UpdatedAt     time.Time      `gorm:"not null"`
}

// CreateAttachment creates a new attachment record
func (s *Storage) CreateAttachment(ctx context.Context, attachment *Attachment) error {
	return s.DB.WithContext(ctx).Create(attachment).Error
}

// GetAttachmentsByIDs retrieves attachments by their IDs
func (s *Storage) GetAttachment(ctx context.Context, id uuid.UUID) (*Attachment, error) {
	var attachment Attachment
	if err := s.DB.WithContext(ctx).First(&attachment, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &attachment, nil
}

func (s *Storage) GetAttachmentsByIDs(ctx context.Context, ids []uuid.UUID) ([]Attachment, error) {
	var attachments []Attachment
	if err := s.DB.WithContext(ctx).Where("id IN ?", ids).Find(&attachments).Error; err != nil {
		return nil, err
	}
	return attachments, nil
}

// --- Project and Task Models ---

// ProjectStatus defines the state of repository analysis
type ProjectStatus string

const (
	ProjectStatusPending   ProjectStatus = "PENDING"
	ProjectStatusAnalyzing ProjectStatus = "ANALYZING"
	ProjectStatusReady     ProjectStatus = "READY"
	ProjectStatusFailed    ProjectStatus = "FAILED"
)

// ProjectTaskStatus defines the state of a project task
type ProjectTaskStatus string

const (
	ProjectTaskStatusBacklog   ProjectTaskStatus = "BACKLOG"
	ProjectTaskStatusAnalysis  ProjectTaskStatus = "ANALYSIS"
	ProjectTaskStatusPlanning  ProjectTaskStatus = "PLANNING"
	ProjectTaskStatusCoding    ProjectTaskStatus = "CODING"
	ProjectTaskStatusReview    ProjectTaskStatus = "REVIEW"
	ProjectTaskStatusVerify    ProjectTaskStatus = "VERIFY"
	ProjectTaskStatusDone      ProjectTaskStatus = "DONE"
	ProjectTaskStatusCancelled ProjectTaskStatus = "CANCELLED"
)

// Project represents a project context
type Project struct {
	ID            uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID        uuid.UUID      `gorm:"type:uuid;not null;index" json:"user_id"`
	Name          string         `gorm:"type:text;not null" json:"name"`
	Description   string         `gorm:"type:text" json:"description"`
	Repository    string         `gorm:"type:text" json:"repository"` // e.g. "owner/repo"
	Status        ProjectStatus  `gorm:"type:varchar(20);default:'READY';not null" json:"status"`
	LastIndexedAt *time.Time     `gorm:"type:timestamp" json:"last_indexed_at"`
	CreatedAt     time.Time      `gorm:"not null" json:"created_at"`
	UpdatedAt     time.Time      `gorm:"not null" json:"updated_at"`
	DeletedAt     gorm.DeletedAt `gorm:"index" json:"-"`
}

// ProjectTask represents a task within a project
type ProjectTask struct {
	ID          uuid.UUID         `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID      uuid.UUID         `gorm:"type:uuid;not null;index" json:"user_id"`
	ProjectID   uuid.UUID         `gorm:"type:uuid;not null;index" json:"project_id"`
	Title       string            `gorm:"type:text;not null" json:"title"`
	Description string            `gorm:"type:text" json:"description"`
	Status      ProjectTaskStatus `gorm:"type:varchar(20);default:'BACKLOG';not null" json:"status"`
	Priority    string            `gorm:"type:varchar(20);default:'medium'" json:"priority"`
	Artifacts   pgtype.JSONB      `gorm:"type:jsonb;default:'{}'" json:"artifacts"` // AnalystOutput + ArchitectPlan
	CreatedAt   time.Time         `gorm:"not null" json:"created_at"`
	UpdatedAt   time.Time         `gorm:"not null" json:"updated_at"`
	DeletedAt   gorm.DeletedAt    `gorm:"index" json:"-"`
}

// TaskStatus defines the state of a scheduled task
type TaskStatus string

const (
	TaskStatusPending   TaskStatus = "pending"
	TaskStatusRunning   TaskStatus = "running"
	TaskStatusCompleted TaskStatus = "completed"
	TaskStatusFailed    TaskStatus = "failed"
)

// Task represents a scheduled job
type Task struct {
	ID        uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID    uuid.UUID      `gorm:"type:uuid;not null" json:"user_id"`
	ChatID    uuid.UUID      `gorm:"type:uuid;not null" json:"chat_id"`
	Type      string         `gorm:"type:varchar(50);not null" json:"type"` // e.g. "agent_message"
	Payload   datatypes.JSON `gorm:"type:jsonb;not null" json:"payload"`    // e.g. {"message": "check news"}
	Tools     datatypes.JSON `gorm:"type:jsonb" json:"tools"`               // Tools that were active when task was created
	CronExpr  string         `gorm:"type:varchar(50)" json:"cron_expr"`     // Optional cron expression
	ExecuteAt time.Time      `gorm:"not null" json:"execute_at"`
	Status    TaskStatus     `gorm:"type:varchar(20);default:'pending';not null" json:"status"`
	Error     string         `gorm:"type:text" json:"error"`
	CreatedAt time.Time      `gorm:"not null" json:"created_at"`
	UpdatedAt time.Time      `gorm:"not null" json:"updated_at"`
}
