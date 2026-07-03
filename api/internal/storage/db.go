package storage

import (
	"fmt"

	"github.com/kliuchnikovv/genie-api/internal/config"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type Storage struct {
	DB *gorm.DB
}

func New(cfg *config.Config) (*Storage, error) {
	dsn := fmt.Sprintf(
		"host=%s user=%s password=%s dbname=%s port=%d sslmode=disable TimeZone=UTC",
		cfg.Database.Host,
		cfg.Database.User,
		cfg.Database.Password,
		cfg.Database.DBName,
		cfg.Database.Port,
	)

	gdb, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, err
	}

	// Enable UUID extension for PostgreSQL
	if err := gdb.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).Error; err != nil {
		return nil, err
	}

	// Auto-migrate models to keep schema in sync with GORM models.
	if err := gdb.AutoMigrate(
		&OAuthToken{},
		&OAuthSession{},
		&AuditSecurity{},
		&User{},
		&Project{},
		&UserList{},
		&ProjectDocument{},
		&Chat{},
		&Message{},
		&RefreshToken{},
		&Attachment{},
		&PluginData{},
		&Integration{},
		&BotIdentity{},
		&PlanDocument{},
		&Notification{},
		&UserDevice{},
		&ProactiveEvent{},
		&WatchReminder{},
		&PendingClientAction{},
		&Heartbeat{},
		&GitHubAppInstallation{},
		&AgentTask{},
		// AgentTaskEvent carries a composite uniqueIndex on (task_id, seq)
		// (idx_agent_task_events_task_seq) so event appends are idempotent.
		// AutoMigrate creates it from the struct tags on a fresh column set, but
		// it will NOT convert a pre-existing plain (non-unique) index — if an
		// older deploy already had one, drop it once by hand so AutoMigrate can
		// recreate it unique.
		&AgentTaskEvent{},
		&UserAPIKey{},
	); err != nil {
		return nil, err
	}

	return &Storage{DB: gdb}, nil
}
