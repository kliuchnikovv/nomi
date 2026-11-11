package storage_test

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/nomi-api/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func newByokDB(t *testing.T) *storage.Storage {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&storage.UserAPIKey{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return &storage.Storage{DB: db}
}

func TestSaveUserAPIKey_UpsertAndDefaultExclusivity(t *testing.T) {
	s := newByokDB(t)
	ctx := context.Background()
	userID := uuid.New()

	// First key, default.
	if err := s.SaveUserAPIKey(ctx, userID, "anthropic", []byte("enc-a"), true); err != nil {
		t.Fatalf("save anthropic: %v", err)
	}
	// Second key, also default — must clear the first's default flag.
	if err := s.SaveUserAPIKey(ctx, userID, "openrouter", []byte("enc-o"), true); err != nil {
		t.Fatalf("save openrouter: %v", err)
	}

	keys, err := s.ListUserAPIKeys(ctx, userID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(keys) != 2 {
		t.Fatalf("expected 2 keys, got %d", len(keys))
	}
	defaults := 0
	for _, k := range keys {
		if k.IsDefault {
			defaults++
			if k.Provider != "openrouter" {
				t.Fatalf("default should be openrouter, got %s", k.Provider)
			}
		}
	}
	if defaults != 1 {
		t.Fatalf("expected exactly 1 default, got %d", defaults)
	}

	// Upsert anthropic with a new ciphertext — must not create a duplicate row.
	if err := s.SaveUserAPIKey(ctx, userID, "anthropic", []byte("enc-a2"), false); err != nil {
		t.Fatalf("re-save anthropic: %v", err)
	}
	keys, _ = s.ListUserAPIKeys(ctx, userID)
	if len(keys) != 2 {
		t.Fatalf("upsert created a duplicate: %d rows", len(keys))
	}
	for _, k := range keys {
		if k.Provider == "anthropic" && string(k.KeyEncrypted) != "enc-a2" {
			t.Fatalf("ciphertext not updated: %q", string(k.KeyEncrypted))
		}
	}
}

func TestSetDefaultUserAPIKey(t *testing.T) {
	s := newByokDB(t)
	ctx := context.Background()
	userID := uuid.New()

	_ = s.SaveUserAPIKey(ctx, userID, "anthropic", []byte("a"), true)
	_ = s.SaveUserAPIKey(ctx, userID, "google", []byte("g"), false)

	if err := s.SetDefaultUserAPIKey(ctx, userID, "google"); err != nil {
		t.Fatalf("set default: %v", err)
	}
	keys, _ := s.ListUserAPIKeys(ctx, userID)
	for _, k := range keys {
		want := k.Provider == "google"
		if k.IsDefault != want {
			t.Fatalf("provider %s default=%v, want %v", k.Provider, k.IsDefault, want)
		}
	}

	// Setting default for an unconfigured provider must error.
	if err := s.SetDefaultUserAPIKey(ctx, userID, "zai"); err == nil {
		t.Fatalf("expected error for unconfigured provider")
	}
}

func TestDeleteUserAPIKey(t *testing.T) {
	s := newByokDB(t)
	ctx := context.Background()
	userID := uuid.New()

	_ = s.SaveUserAPIKey(ctx, userID, "anthropic", []byte("a"), true)
	if err := s.DeleteUserAPIKey(ctx, userID, "anthropic"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	keys, _ := s.ListUserAPIKeys(ctx, userID)
	if len(keys) != 0 {
		t.Fatalf("expected 0 keys after delete, got %d", len(keys))
	}
	// Re-add after delete must not collide on the unique (user, provider) index.
	if err := s.SaveUserAPIKey(ctx, userID, "anthropic", []byte("a2"), true); err != nil {
		t.Fatalf("re-add after delete: %v", err)
	}
}
