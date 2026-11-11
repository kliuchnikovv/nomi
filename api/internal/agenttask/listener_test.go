package agenttask

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/nomi-api/internal/storage"
	"go.uber.org/zap"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func newListenerTestStore(t *testing.T) *storage.Storage {
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
	}
	for _, stmt := range stmts {
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatalf("create table: %v", err)
		}
	}
	return &storage.Storage{DB: db}
}

func intPtr(i int) *int { return &i }

func rawPtr(s string) *json.RawMessage {
	r := json.RawMessage(s)
	return &r
}

func TestPersistTaskAppliesRecoveryFieldsAndClearsPendingApproval(t *testing.T) {
	store := newListenerTestStore(t)
	l := &Listener{store: store, logger: zap.NewNop()}
	ctx := context.Background()

	taskID := uuid.New()
	// Seed a task blocked on input with a pending approval gate.
	if err := store.CreateAgentTask(ctx, &storage.AgentTask{
		ID:              taskID,
		UserID:          uuid.New(),
		ChatID:          uuid.New(),
		Goal:            "g",
		Status:          "waiting_input",
		Background:      true,
		PendingApproval: datatypes.JSON(`{"request_id":"r1","step_id":"s1"}`),
	}); err != nil {
		t.Fatalf("seed task: %v", err)
	}

	// Runner resumes: moves to running, advances step, bumps attempt.
	env := &eventEnvelope{
		Status:      "running",
		CurrentStep: intPtr(3),
		Attempt:     intPtr(2),
	}
	if err := l.persistTask(ctx, taskID, env); err != nil {
		t.Fatalf("persistTask: %v", err)
	}

	got, err := store.GetAgentTaskByID(ctx, taskID)
	if err != nil {
		t.Fatalf("reload task: %v", err)
	}
	if got.Status != "running" {
		t.Fatalf("status: want running, got %q", got.Status)
	}
	if got.CurrentStep != 3 {
		t.Fatalf("current_step: want 3, got %d", got.CurrentStep)
	}
	if got.Attempt != 2 {
		t.Fatalf("attempt: want 2, got %d", got.Attempt)
	}
	// Leaving waiting_input must clear the pending approval gate.
	if len(got.PendingApproval) != 0 {
		t.Fatalf("pending_approval: want cleared, got %s", string(got.PendingApproval))
	}
}

func TestPersistTaskSetsPendingApprovalWhenWaiting(t *testing.T) {
	store := newListenerTestStore(t)
	l := &Listener{store: store, logger: zap.NewNop()}
	ctx := context.Background()

	taskID := uuid.New()
	if err := store.CreateAgentTask(ctx, &storage.AgentTask{
		ID:         taskID,
		UserID:     uuid.New(),
		ChatID:     uuid.New(),
		Goal:       "g",
		Status:     "running",
		Background: true,
	}); err != nil {
		t.Fatalf("seed task: %v", err)
	}

	// Runner blocks on input: sets waiting_input + a pending gate; must persist.
	env := &eventEnvelope{
		Status:          "waiting_input",
		PendingApproval: rawPtr(`{"request_id":"r9","step_id":"s2"}`),
	}
	if err := l.persistTask(ctx, taskID, env); err != nil {
		t.Fatalf("persistTask: %v", err)
	}

	got, err := store.GetAgentTaskByID(ctx, taskID)
	if err != nil {
		t.Fatalf("reload task: %v", err)
	}
	if got.Status != "waiting_input" {
		t.Fatalf("status: want waiting_input, got %q", got.Status)
	}
	var pa struct {
		RequestID string `json:"request_id"`
		StepID    string `json:"step_id"`
	}
	if err := json.Unmarshal(got.PendingApproval, &pa); err != nil {
		t.Fatalf("unmarshal pending_approval %q: %v", string(got.PendingApproval), err)
	}
	if pa.RequestID != "r9" || pa.StepID != "s2" {
		t.Fatalf("pending_approval mismatch: %+v", pa)
	}
}
