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

	// Auto-migrate models to keep schema in sync with GORM models.
	// We run AutoMigrate because you asked to enable AutoMigrate. Existing SQL migrations can remain as canonical source if you prefer.
	if err := gdb.AutoMigrate(
		&OAuthToken{},
		&IntegrationLog{},
		&AuditSecurity{},
	); err != nil {
		return nil, err
	}

	return &Storage{DB: gdb}, nil
}
