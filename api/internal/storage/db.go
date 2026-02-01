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

	// Migration: Rename specs to artifacts in project_tasks if it exists
	if gdb.Migrator().HasColumn(&ProjectTask{}, "specs") {
		if err := gdb.Migrator().RenameColumn(&ProjectTask{}, "specs", "artifacts"); err != nil {
			return nil, err
		}
	}

	// Auto-migrate models to keep schema in sync with GORM models.
	if err := gdb.AutoMigrate(
		&OAuthToken{},
		&OAuthSession{},
		&AuditSecurity{},
		&User{},
		&Chat{},
		&Message{},
		&RefreshToken{},
		&Inbox{},
		&PluginChat{},
		&Attachment{},
		&Task{},
		&TeamKVStore{},
		&Project{},
		&ProjectTask{},
		&List{},
		&ListItem{},
	); err != nil {
		return nil, err
	}

	return &Storage{DB: gdb}, nil
}
