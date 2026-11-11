package storage_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/nomi-api/internal/storage"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func newTestDB(t *testing.T) *storage.Storage {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("failed to open in-memory db: %v", err)
	}
	if err := db.Exec(`CREATE TABLE integrations (
		id           TEXT PRIMARY KEY,
		user_id      TEXT NOT NULL,
		name         TEXT NOT NULL DEFAULT '',
		provider     TEXT NOT NULL,
		account_email TEXT NOT NULL DEFAULT '',
		params       TEXT NOT NULL DEFAULT '',
		enabled      INTEGER NOT NULL DEFAULT 1,
		created_at   DATETIME NOT NULL,
		updated_at   DATETIME NOT NULL
	)`).Error; err != nil {
		t.Fatalf("failed to create table: %v", err)
	}
	return &storage.Storage{DB: db}
}

// UpsertIntegration creates or updates an integration row matched by (user_id, provider, account_email).
// Two accounts of the same provider for the same user must produce two separate rows.
func TestUpsertIntegration_DifferentAccountsSameProvider_CreatesSeprateRows(t *testing.T) {
	s := newTestDB(t)
	userID := uuid.New()

	first := &storage.Integration{
		UserID:       userID,
		Provider:     "gmail",
		AccountEmail: "alice@gmail.com",
		Name:         "alice@gmail.com",
		Params:       `{"access_token":"tok_alice"}`,
		Enabled:      true,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	second := &storage.Integration{
		UserID:       userID,
		Provider:     "gmail",
		AccountEmail: "bob@gmail.com",
		Name:         "bob@gmail.com",
		Params:       `{"access_token":"tok_bob"}`,
		Enabled:      true,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	if err := s.UpsertIntegration(first); err != nil {
		t.Fatalf("first upsert failed: %v", err)
	}
	if err := s.UpsertIntegration(second); err != nil {
		t.Fatalf("second upsert failed: %v", err)
	}

	var rows []storage.Integration
	s.DB.Where("user_id = ? AND provider = ?", userID, "gmail").Find(&rows)

	if len(rows) != 2 {
		t.Errorf("expected 2 gmail integrations, got %d", len(rows))
	}
}

func TestUpsertIntegration_SameAccountSameProvider_UpdatesExistingRow(t *testing.T) {
	s := newTestDB(t)
	userID := uuid.New()

	orig := &storage.Integration{
		UserID:       userID,
		Provider:     "gmail",
		AccountEmail: "alice@gmail.com",
		Name:         "alice@gmail.com",
		Params:       `{"access_token":"old_token"}`,
		Enabled:      true,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	if err := s.UpsertIntegration(orig); err != nil {
		t.Fatalf("first upsert failed: %v", err)
	}

	updated := &storage.Integration{
		UserID:       userID,
		Provider:     "gmail",
		AccountEmail: "alice@gmail.com",
		Name:         "alice@gmail.com",
		Params:       `{"access_token":"new_token"}`,
		Enabled:      true,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	if err := s.UpsertIntegration(updated); err != nil {
		t.Fatalf("second upsert failed: %v", err)
	}

	var rows []storage.Integration
	s.DB.Where("user_id = ? AND provider = ?", userID, "gmail").Find(&rows)

	if len(rows) != 1 {
		t.Errorf("expected 1 gmail integration, got %d", len(rows))
	}
	if rows[0].Params != `{"access_token":"new_token"}` {
		t.Errorf("expected updated params, got %s", rows[0].Params)
	}
}
