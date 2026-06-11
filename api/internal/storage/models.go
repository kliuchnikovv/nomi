package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// Chat represents a chat in the database
type Chat struct {
	ID       uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID   uuid.UUID `gorm:"type:uuid;not null;index:idx_chats_user_updated,priority:1"`
	Model    string    `gorm:"type:text;not null"`
	Title    string    `gorm:"not null"`
	Mode     string    `gorm:"type:varchar(20);not null;default:'agent'"`   // 'agent' or 'team'
	Type     string    `gorm:"type:varchar(20);not null;default:'regular'"` // 'regular' or 'persistent'
	ChatType string    `gorm:"type:text;not null;default:'standard'"`       // 'standard' or 'updates'

	TeamID     *string    `gorm:"type:varchar(50);default:null"` // e.g. 'dnd_team', 'travel_planning'
	ProjectID  *uuid.UUID `gorm:"type:uuid;default:null;index:idx_chats_project_id"`
	Icon       string     `gorm:"type:varchar(10);default:''"`
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
	ContextItems datatypes.JSON `gorm:"type:jsonb"` // Stores context items (emails, documents, etc.)
	Attachments  []Attachment   `gorm:"foreignKey:MessageID"`
	CreatedAt    time.Time      `gorm:"not null;index:idx_messages_chat_created,priority:2,sort:desc"`
	UpdatedAt    time.Time      `gorm:"not null"`
	Archived     bool           `gorm:"not null;default:false"`
	// StoppedAt is set when the user explicitly stopped generation for this turn.
	// The client uses it to suppress automatic re-submission of the user message.
	StoppedAt *time.Time `gorm:"default:null"`
}

type Integration struct {
	ID           uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID       uuid.UUID `gorm:"type:uuid;not null"`
	Name         string    `gorm:"type:text;not null"`
	Provider     string    `gorm:"type:text;not null"`
	AccountEmail string    `gorm:"type:text;not null;default:''"`
	Params       string    `gorm:"type:text;not null"`
	Enabled      bool      `gorm:"default:true;not null"`
	CreatedAt    time.Time `gorm:"not null"`
	UpdatedAt    time.Time `gorm:"not null"`
}

// PluginData is a generic key-value store for plugin-specific data.
// Each plugin can store multiple records per user (e.g. linked accounts, settings).
type PluginData struct {
	ID         uuid.UUID      `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	UserID     uuid.UUID      `gorm:"type:uuid;not null;index:idx_pd_user_plugin,priority:1"`
	PluginName string         `gorm:"type:varchar(50);not null;index:idx_pd_user_plugin,priority:2;index:idx_pd_type,priority:2"`
	RecordType string         `gorm:"type:varchar(50);not null;index:idx_pd_type,priority:3"`
	Data       datatypes.JSON `gorm:"type:jsonb;not null;default:'{}'"`
	CreatedAt  time.Time      `gorm:"not null"`
	UpdatedAt  time.Time      `gorm:"not null"`
}

// Project represents a user-defined project that groups related chats
type Project struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID      uuid.UUID      `gorm:"type:uuid;not null;index"`
	Name        string         `gorm:"type:text;not null"`
	Description string         `gorm:"type:text;not null;default:''"`
	Icon        string         `gorm:"type:varchar(10);not null;default:'📁'"`
	CreatedAt   time.Time      `gorm:"not null"`
	UpdatedAt   time.Time      `gorm:"not null"`
	DeletedAt   gorm.DeletedAt `gorm:"index"`
}

// Notification represents a scheduled push notification
type Notification struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID      uuid.UUID      `gorm:"type:uuid;not null;index"`
	Type        string         `gorm:"type:varchar(20);not null"` // 'reminder' | 'event' | 'proactive'
	Title       string         `gorm:"type:text;not null"`
	Body        string         `gorm:"type:text;not null"`
	DeepLink    datatypes.JSON `gorm:"type:jsonb"`
	ScheduledAt time.Time      `gorm:"not null;index"`
	FiredAt     *time.Time     `gorm:"default:null"`
	Metadata    datatypes.JSON `gorm:"type:jsonb"`
	CreatedAt   time.Time      `gorm:"not null"`
}

// ProactiveEvent represents a candidate event surfaced by a reactive source.
type ProactiveEvent struct {
	ID             uuid.UUID      `gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID         uuid.UUID      `gorm:"type:uuid;not null;index:idx_proactive_events_user_state,priority:1"`
	Source         string         `gorm:"type:text;not null"` // 'calendar' | 'email'
	EventType      string         `gorm:"type:text;not null"` // 'calendar_upcoming' | 'email_new'
	Payload        datatypes.JSON `gorm:"type:jsonb;not null"`
	FireAt         *time.Time     `gorm:"default:null;index:idx_proactive_events_state_fire_at,priority:2"`
	State          string         `gorm:"type:text;not null;default:'pending';index:idx_proactive_events_user_state,priority:2;index:idx_proactive_events_state_fire_at,priority:1"`
	DecisionReason *string        `gorm:"type:text;default:null"`
	CreatedAt      time.Time      `gorm:"not null"`
	ProcessedAt    *time.Time     `gorm:"default:null"`
}

// WatchReminder is a self-reminder the agent set on the user's behalf
// ("remind me about Y at time T"). The scheduler converts due rows into
// proactive "watch_reminder" events on each tick.
type WatchReminder struct {
	ID        uuid.UUID  `gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID    uuid.UUID  `gorm:"type:uuid;not null;index:idx_watch_user_state,priority:1"`
	Context   string     `gorm:"type:text;not null"`                                                                                               // what to resurface (free text from the agent)
	FireAt    time.Time  `gorm:"not null;index:idx_watch_state_fire,priority:2"`                                                                   // when (UTC)
	State     string     `gorm:"type:text;not null;default:'pending';index:idx_watch_user_state,priority:2;index:idx_watch_state_fire,priority:1"` // pending|fired|cancelled
	CreatedAt time.Time  `gorm:"not null"`
	FiredAt   *time.Time `gorm:"default:null"`
}

// PendingClientAction is a client-only tool call (e.g. iOS reminder) that the
// brain could not execute immediately because no device was connected. It is
// queued here and drained by the device when it next comes online (foreground,
// silent-push wake, or background fetch). The result is delivered back to the
// originating channel (e.g. Telegram) via the stored delivery context.
type PendingClientAction struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index:idx_pending_actions_user_status,priority:1"`
	// Source is the originating delivery channel, e.g. "telegram".
	Source string `gorm:"type:text;not null"`
	// DeliveryContext carries what the delivery handler needs to send a follow-up
	// (e.g. {"telegram_chat_id": 123, "user_id": "..."}).
	DeliveryContext datatypes.JSON `gorm:"type:jsonb"`
	// SessionID is the originating session (the client_action frame's chat_id);
	// the device echoes it back so the result round-trips on the right channel.
	SessionID     string         `gorm:"type:text;not null"`
	CallID        string         `gorm:"type:text;not null;uniqueIndex:idx_pending_actions_call_id"`
	Tool          string         `gorm:"type:text;not null"`
	Method        string         `gorm:"type:text;not null"`
	Params        datatypes.JSON `gorm:"type:jsonb"`
	IntegrationID *string        `gorm:"type:text;default:null"`
	// Status: 'pending' | 'done' | 'failed' | 'expired'.
	Status      string     `gorm:"type:text;not null;default:'pending';index:idx_pending_actions_user_status,priority:2"`
	Result      *string    `gorm:"type:text;default:null"`
	ExpiresAt   *time.Time `gorm:"default:null;index:idx_pending_actions_expires_at"`
	CreatedAt   time.Time  `gorm:"not null"`
	DeliveredAt *time.Time `gorm:"default:null"`
}

// UserDevice stores device tokens for push notification delivery
type UserDevice struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID      uuid.UUID `gorm:"type:uuid;not null;index"`
	DeviceToken string    `gorm:"type:text;not null;uniqueIndex:idx_user_device"`
	Platform    string    `gorm:"type:varchar(10);not null"` // 'ios' | 'android'
	CreatedAt   time.Time `gorm:"not null"`
}

// Heartbeat is a diagnostic record written when a background task wakes up.
// Used to confirm that mobile background execution actually runs.
type Heartbeat struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID      uuid.UUID      `gorm:"type:uuid;not null;index:idx_heartbeats_user_received,priority:1"`
	Source      string         `gorm:"type:varchar(40);not null"` // e.g. 'ios-bg', 'ios-manual'
	Trigger     string         `gorm:"type:varchar(40);not null"` // 'background-fetch' | 'manual'
	TriggeredAt *time.Time     `gorm:"default:null"`              // client-reported wake time
	ReceivedAt  time.Time      `gorm:"not null;index:idx_heartbeats_user_received,priority:2,sort:desc"`
	Meta        datatypes.JSON `gorm:"type:jsonb"`
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

// ── PluginData CRUD ─────────────────────────────────────

func (s *Storage) CreatePluginData(ctx context.Context, pd *PluginData) error {
	return s.DB.WithContext(ctx).Create(pd).Error
}

func (s *Storage) GetPluginData(ctx context.Context, userID uuid.UUID, pluginName, recordType string) ([]PluginData, error) {
	var results []PluginData
	err := s.DB.WithContext(ctx).
		Where("user_id = ? AND plugin_name = ? AND record_type = ?", userID, pluginName, recordType).
		Find(&results).Error
	return results, err
}

// GetPluginDataByField finds a single record by a JSONB field value.
// Example: GetPluginDataByField(ctx, "telegram", "linked_account", "telegram_chat_id", "123456")
func (s *Storage) GetPluginDataByField(ctx context.Context, pluginName, recordType, jsonField, value string) (*PluginData, error) {
	var pd PluginData
	err := s.DB.WithContext(ctx).
		Where("plugin_name = ? AND record_type = ? AND data->>? = ?", pluginName, recordType, jsonField, value).
		First(&pd).Error
	if err != nil {
		return nil, err
	}
	return &pd, nil
}

func (s *Storage) UpdatePluginData(ctx context.Context, id uuid.UUID, data datatypes.JSON) error {
	return s.DB.WithContext(ctx).
		Model(&PluginData{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{"data": data, "updated_at": time.Now()}).Error
}

func (s *Storage) DeletePluginData(ctx context.Context, id uuid.UUID) error {
	return s.DB.WithContext(ctx).Where("id = ?", id).Delete(&PluginData{}).Error
}
