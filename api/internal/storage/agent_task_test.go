package storage_test

import (
	"context"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// newAgentTaskTestStore builds an in-memory sqlite store with hand-written DDL.
// GORM's Postgres-only defaults (gen_random_uuid()) break AutoMigrate on
// sqlite, so the schema is created explicitly (mirrors the watch_test pattern).
func newAgentTaskTestStore(t *testing.T) *storage.Storage {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}
	stmts := []string{
		`CREATE TABLE agent_tasks (
			id               TEXT PRIMARY KEY,
			user_id          TEXT NOT NULL,
			chat_id          TEXT NOT NULL,
			goal             TEXT NOT NULL,
			background       INTEGER NOT NULL DEFAULT 0,
			agent            TEXT NOT NULL DEFAULT '',
			status           TEXT NOT NULL DEFAULT 'planning',
			plan             TEXT,
			result           TEXT NOT NULL DEFAULT '',
			current_step     INTEGER NOT NULL DEFAULT 0,
			attempt          INTEGER NOT NULL DEFAULT 0,
			pending_approval TEXT,
			created_at       DATETIME NOT NULL,
			updated_at       DATETIME NOT NULL,
			finished_at      DATETIME
		)`,
		`CREATE TABLE agent_task_events (
			id         TEXT PRIMARY KEY,
			task_id    TEXT NOT NULL,
			seq        INTEGER NOT NULL,
			kind       TEXT NOT NULL,
			payload    TEXT,
			created_at DATETIME NOT NULL
		)`,
		`CREATE UNIQUE INDEX idx_agent_task_events_task_seq ON agent_task_events (task_id, seq)`,
	}
	for _, stmt := range stmts {
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatalf("create table: %v", err)
		}
	}
	return &storage.Storage{DB: db}
}

func mkTask(t *testing.T, s *storage.Storage, status string, background bool, updatedAt time.Time) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	task := &storage.AgentTask{
		ID:         uuid.New(),
		UserID:     uuid.New(),
		ChatID:     uuid.New(),
		Goal:       "g",
		Status:     status,
		Background: background,
	}
	if err := s.CreateAgentTask(ctx, task); err != nil {
		t.Fatalf("create task: %v", err)
	}
	// CreateAgentTask stamps updated_at=now; override for staleness testing.
	if err := s.DB.Model(&storage.AgentTask{}).
		Where("id = ?", task.ID).Update("updated_at", updatedAt).Error; err != nil {
		t.Fatalf("override updated_at: %v", err)
	}
	return task.ID
}

func TestListUnfinishedAgentTasks(t *testing.T) {
	s := newAgentTaskTestStore(t)
	ctx := context.Background()
	old := time.Now().Add(-5 * time.Minute)
	fresh := time.Now()

	// Should be returned: non-terminal + background + stale.
	wantRunning := mkTask(t, s, "running", true, old)
	wantWaiting := mkTask(t, s, "waiting_input", true, old)
	wantPlanning := mkTask(t, s, "planning", true, old)
	wantPaused := mkTask(t, s, "paused", true, old)

	// Should be excluded.
	_ = mkTask(t, s, "done", true, old)         // terminal
	_ = mkTask(t, s, "failed", true, old)       // terminal
	_ = mkTask(t, s, "cancelled", true, old)    // terminal
	_ = mkTask(t, s, "running", false, old)     // not background
	_ = mkTask(t, s, "running", true, fresh)    // not stale

	rows, err := s.ListUnfinishedAgentTasks(ctx, 60*time.Second)
	if err != nil {
		t.Fatalf("list unfinished: %v", err)
	}

	got := map[uuid.UUID]bool{}
	for _, r := range rows {
		got[r.ID] = true
	}
	want := []uuid.UUID{wantRunning, wantWaiting, wantPlanning, wantPaused}
	if len(rows) != len(want) {
		t.Fatalf("expected %d unfinished tasks, got %d", len(want), len(rows))
	}
	for _, id := range want {
		if !got[id] {
			t.Fatalf("expected task %s in results", id)
		}
	}
}

func TestAppendAgentTaskEventIdempotent(t *testing.T) {
	s := newAgentTaskTestStore(t)
	ctx := context.Background()
	taskID := mkTask(t, s, "running", true, time.Now())

	ev := func() *storage.AgentTaskEvent {
		return &storage.AgentTaskEvent{
			TaskID:  taskID,
			Seq:     1,
			Kind:    "log",
			Payload: datatypes.JSON(`{"message":"hi"}`),
		}
	}

	if err := s.AppendAgentTaskEvent(ctx, ev()); err != nil {
		t.Fatalf("first append: %v", err)
	}
	// Re-publishing the same (task_id, seq) must be a no-op, not an error.
	if err := s.AppendAgentTaskEvent(ctx, ev()); err != nil {
		t.Fatalf("second append (duplicate) should be no-op: %v", err)
	}

	var count int64
	if err := s.DB.Model(&storage.AgentTaskEvent{}).
		Where("task_id = ? AND seq = ?", taskID, 1).Count(&count).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 row for (task_id, seq=1), got %d", count)
	}

	// A different seq still inserts.
	e2 := ev()
	e2.Seq = 2
	if err := s.AppendAgentTaskEvent(ctx, e2); err != nil {
		t.Fatalf("append seq=2: %v", err)
	}
	max, err := s.MaxAgentTaskEventSeq(ctx, taskID)
	if err != nil {
		t.Fatalf("max seq: %v", err)
	}
	if max != 2 {
		t.Fatalf("expected max seq 2, got %d", max)
	}
}
