package storage_test

import (
	"context"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/nomi-api/internal/storage"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func newProactiveTestStore(t *testing.T) *storage.Storage {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}
	// Hand-written DDL: GORM models use Postgres-only defaults (gen_random_uuid())
	// that the sqlite driver rejects during AutoMigrate.
	stmts := []string{
		`CREATE TABLE proactive_events (
			id              TEXT PRIMARY KEY,
			user_id         TEXT NOT NULL,
			source          TEXT NOT NULL,
			event_type      TEXT NOT NULL,
			payload         TEXT NOT NULL,
			fire_at         DATETIME,
			state           TEXT NOT NULL DEFAULT 'pending',
			decision_reason TEXT,
			created_at      DATETIME NOT NULL,
			processed_at    DATETIME
		)`,
		`CREATE TABLE watch_reminders (
			id         TEXT PRIMARY KEY,
			user_id    TEXT NOT NULL,
			context    TEXT NOT NULL,
			fire_at    DATETIME NOT NULL,
			state      TEXT NOT NULL DEFAULT 'pending',
			created_at DATETIME NOT NULL,
			fired_at   DATETIME
		)`,
	}
	for _, stmt := range stmts {
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatalf("create table: %v", err)
		}
	}
	return &storage.Storage{DB: db}
}

func TestListDueWatchReminders(t *testing.T) {
	s := newProactiveTestStore(t)
	ctx := context.Background()
	userID := uuid.New()
	now := time.Now().UTC()

	due, _ := s.CreateWatchReminder(ctx, &storage.WatchReminder{
		UserID: userID, Context: "due now", FireAt: now.Add(-1 * time.Minute),
	})
	_, _ = s.CreateWatchReminder(ctx, &storage.WatchReminder{
		UserID: userID, Context: "future", FireAt: now.Add(2 * time.Hour),
	})
	// A fired reminder must never be returned.
	fired, _ := s.CreateWatchReminder(ctx, &storage.WatchReminder{
		UserID: userID, Context: "already fired", FireAt: now.Add(-1 * time.Hour),
	})
	if err := s.MarkWatchFired(ctx, fired.ID); err != nil {
		t.Fatalf("mark fired: %v", err)
	}

	rows, err := s.ListDueWatchReminders(ctx, now, 100)
	if err != nil {
		t.Fatalf("list due: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 due reminder, got %d", len(rows))
	}
	if rows[0].ID != due.ID {
		t.Fatalf("expected due reminder %s, got %s", due.ID, rows[0].ID)
	}
}

func TestCancelWatchReminderScopedToUser(t *testing.T) {
	s := newProactiveTestStore(t)
	ctx := context.Background()
	owner := uuid.New()
	other := uuid.New()

	w, _ := s.CreateWatchReminder(ctx, &storage.WatchReminder{
		UserID: owner, Context: "mine", FireAt: time.Now().UTC().Add(time.Hour),
	})

	// A different user cannot cancel it.
	if err := s.CancelWatchReminder(ctx, other, w.ID); err != nil {
		t.Fatalf("cancel (other user): %v", err)
	}
	pending, _ := s.ListWatchReminders(ctx, owner)
	if len(pending) != 1 {
		t.Fatalf("expected reminder to survive cross-user cancel, got %d pending", len(pending))
	}

	// The owner can.
	if err := s.CancelWatchReminder(ctx, owner, w.ID); err != nil {
		t.Fatalf("cancel (owner): %v", err)
	}
	pending, _ = s.ListWatchReminders(ctx, owner)
	if len(pending) != 0 {
		t.Fatalf("expected 0 pending after owner cancel, got %d", len(pending))
	}
}

func TestCountSurfacedEventsInWindow(t *testing.T) {
	s := newProactiveTestStore(t)
	ctx := context.Background()
	userID := uuid.New()
	other := uuid.New()

	mk := func(uid uuid.UUID, state string, createdAt time.Time) {
		ev := &storage.ProactiveEvent{
			ID:        uuid.New(),
			UserID:    uid,
			Source:    "calendar",
			EventType: "calendar_upcoming",
			Payload:   datatypes.JSON(`{}`),
			State:     state,
		}
		if _, err := s.CreateProactiveEvent(ctx, ev); err != nil {
			t.Fatalf("create event: %v", err)
		}
		// CreateProactiveEvent stamps CreatedAt=now; override for the window test.
		if err := s.DB.Model(&storage.ProactiveEvent{}).
			Where("id = ?", ev.ID).Update("created_at", createdAt).Error; err != nil {
			t.Fatalf("override created_at: %v", err)
		}
	}

	now := time.Now().UTC()
	mk(userID, "surfaced", now.Add(-1*time.Hour))       // in window
	mk(userID, "surfaced", now.Add(-2*time.Hour))       // in window
	mk(userID, "surfaced", now.Add(-48*time.Hour))      // outside window
	mk(userID, "rules_rejected", now.Add(-1*time.Hour)) // wrong state
	mk(other, "surfaced", now.Add(-1*time.Hour))        // wrong user

	count, err := s.CountSurfacedEventsInWindow(ctx, userID, 24*time.Hour)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected 2 surfaced in 24h window, got %d", count)
	}
}
