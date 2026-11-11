package storage_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/nomi-api/internal/chat"
	"github.com/kliuchnikovv/nomi-api/internal/storage"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func newTestDBWithMessages(t *testing.T) *storage.Storage {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("failed to open in-memory db: %v", err)
	}
	stmts := []string{
		`CREATE TABLE chats (
			id         TEXT PRIMARY KEY,
			user_id    TEXT NOT NULL,
			model      TEXT NOT NULL DEFAULT '',
			title      TEXT NOT NULL DEFAULT '',
			mode       TEXT NOT NULL DEFAULT 'agent',
			type       TEXT NOT NULL DEFAULT 'regular',
			chat_type  TEXT NOT NULL DEFAULT 'standard',
			team_id    TEXT,
			project_id TEXT,
			icon       TEXT NOT NULL DEFAULT '',
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL,
			archived_at DATETIME,
			deleted_at  DATETIME
		)`,
		`CREATE TABLE messages (
			id            TEXT PRIMARY KEY,
			chat_id       TEXT NOT NULL,
			user_id       TEXT NOT NULL,
			role          TEXT NOT NULL,
			text          TEXT NOT NULL DEFAULT '',
			agent_id      TEXT,
			tool_calls    TEXT,
			content_parts TEXT,
			reasoning     TEXT NOT NULL DEFAULT '',
			model         TEXT NOT NULL DEFAULT '',
			actions       TEXT,
			context_items TEXT,
			created_at    DATETIME NOT NULL,
			updated_at    DATETIME NOT NULL,
			archived      INTEGER NOT NULL DEFAULT 0,
			stopped_at    DATETIME,
			meta          TEXT
		)`,
		`CREATE TABLE attachments (
			id         TEXT PRIMARY KEY,
			message_id TEXT,
			user_id    TEXT NOT NULL,
			file_name  TEXT NOT NULL DEFAULT '',
			file_type  TEXT NOT NULL DEFAULT '',
			size       INTEGER NOT NULL DEFAULT 0,
			content    BLOB NOT NULL DEFAULT '',
			created_at DATETIME NOT NULL
		)`,
	}
	for _, stmt := range stmts {
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatalf("failed to create table: %v", err)
		}
	}
	return &storage.Storage{DB: db}
}

// TestGetMessages_ReturnsLatestMessages verifies that when there are more messages than
// the limit, GetMessages returns the NEWEST messages (not the oldest), ordered oldest-first.
func TestGetMessages_ReturnsLatestMessages(t *testing.T) {
	s := newTestDBWithMessages(t)
	ctx := context.Background()

	userID := uuid.New()
	chatID := uuid.New()

	// Insert a chat so UpsertMessage's ownership check passes
	s.DB.Create(&storage.Chat{
		ID:        chatID,
		UserID:    userID,
		Model:     "test",
		Title:     "test chat",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	})

	baseTime := time.Now().Add(-time.Hour)
	const total = 55
	for i := 0; i < total; i++ {
		err := s.UpsertMessage(ctx, userID, &chat.Message{
			ID:        uuid.New(),
			ChatID:    chatID,
			Role:      "user",
			Text:      fmt.Sprintf("message %d", i),
			CreatedAt: baseTime.Add(time.Duration(i) * time.Minute),
		})
		if err != nil {
			t.Fatalf("UpsertMessage(%d) failed: %v", i, err)
		}
	}

	msgs, err := s.GetMessages(ctx, userID, chatID, 50)
	if err != nil {
		t.Fatalf("GetMessages failed: %v", err)
	}
	if len(msgs) != 50 {
		t.Fatalf("expected 50 messages, got %d", len(msgs))
	}

	// Latest 50 are messages[5..54]; result must be in chronological order.
	if msgs[0].Text != "message 5" {
		t.Errorf("first message: want %q, got %q", "message 5", msgs[0].Text)
	}
	if msgs[49].Text != "message 54" {
		t.Errorf("last message: want %q, got %q", "message 54", msgs[49].Text)
	}
}

// TestGetMessages_AllMessagesWhenBelowLimit verifies no messages are lost when
// the total count is less than the limit.
func TestGetMessages_AllMessagesWhenBelowLimit(t *testing.T) {
	s := newTestDBWithMessages(t)
	ctx := context.Background()

	userID := uuid.New()
	chatID := uuid.New()

	s.DB.Create(&storage.Chat{
		ID:        chatID,
		UserID:    userID,
		Model:     "test",
		Title:     "test chat",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	})

	baseTime := time.Now().Add(-time.Hour)
	for i := 0; i < 5; i++ {
		s.UpsertMessage(ctx, userID, &chat.Message{
			ID:        uuid.New(),
			ChatID:    chatID,
			Role:      "user",
			Text:      fmt.Sprintf("message %d", i),
			CreatedAt: baseTime.Add(time.Duration(i) * time.Minute),
		})
	}

	msgs, err := s.GetMessages(ctx, userID, chatID, 50)
	if err != nil {
		t.Fatalf("GetMessages failed: %v", err)
	}
	if len(msgs) != 5 {
		t.Fatalf("expected 5 messages, got %d", len(msgs))
	}
	if msgs[0].Text != "message 0" {
		t.Errorf("first message: want %q, got %q", "message 0", msgs[0].Text)
	}
	if msgs[4].Text != "message 4" {
		t.Errorf("last message: want %q, got %q", "message 4", msgs[4].Text)
	}
}
