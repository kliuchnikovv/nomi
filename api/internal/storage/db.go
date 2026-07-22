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
		// (idx_agent_task_events_task_seq_v2) so event appends are idempotent.
		// The index was renamed with a _v2 suffix because AutoMigrate won't
		// retrofit uniqueness onto a pre-existing index of the same name — the
		// original idx_agent_task_events_task_seq was created non-unique before
		// this pair needed to be unique, and older deploys still have it that way.
		&AgentTaskEvent{},
		&UserAPIKey{},
	); err != nil {
		return nil, err
	}

	return &Storage{DB: gdb}, nil
}
