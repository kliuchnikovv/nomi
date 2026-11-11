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

// newPlanDocDB creates an isolated SQLite in-memory database with only the
// plan_documents table. It is independent of newTestDB to avoid coupling.
func newPlanDocDB(t *testing.T) *storage.Storage {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("failed to open in-memory db: %v", err)
	}
	if err := db.Exec(`CREATE TABLE plan_documents (
		id          TEXT PRIMARY KEY,
		user_id     TEXT NOT NULL,
		date        TEXT NOT NULL,
		items       TEXT NOT NULL DEFAULT '[]',
		created_at  DATETIME NOT NULL,
		updated_at  DATETIME NOT NULL,
		UNIQUE (user_id, date)
	)`).Error; err != nil {
		t.Fatalf("failed to create table: %v", err)
	}
	return &storage.Storage{DB: db}
}

// makeDoc is a helper to create a PlanDocument with an items JSON payload.
func makeDoc(userID uuid.UUID, date string, items string) *storage.PlanDocument {
	if items == "" {
		items = "[]"
	}
	return &storage.PlanDocument{
		UserID: userID,
		Date:   date,
		Items:  datatypes.JSON([]byte(items)),
	}
}

// ── GetPlanDocument ───────────────────────────────────────────────────────────

func TestPlanDocGet_ReturnsDoc(t *testing.T) {
	s := newPlanDocDB(t)
	userID := uuid.New()

	created, err := s.CreatePlanDocument(context.Background(), makeDoc(userID, "2024-01-15", `[{"title":"Task"}]`))
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}

	got, err := s.GetPlanDocument(context.Background(), userID, "2024-01-15")
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if got.ID != created.ID {
		t.Errorf("expected ID %s, got %s", created.ID, got.ID)
	}
	if got.Date != "2024-01-15" {
		t.Errorf("expected date 2024-01-15, got %s", got.Date)
	}
}

func TestPlanDocGet_NotFoundWrongDate(t *testing.T) {
	s := newPlanDocDB(t)
	userID := uuid.New()

	if _, err := s.CreatePlanDocument(context.Background(), makeDoc(userID, "2024-01-15", "")); err != nil {
		t.Fatalf("create failed: %v", err)
	}

	_, err := s.GetPlanDocument(context.Background(), userID, "2024-01-16")
	if err != gorm.ErrRecordNotFound {
		t.Errorf("expected ErrRecordNotFound, got %v", err)
	}
}

func TestPlanDocGet_NotFoundWrongUser(t *testing.T) {
	s := newPlanDocDB(t)
	userA := uuid.New()
	userB := uuid.New()

	if _, err := s.CreatePlanDocument(context.Background(), makeDoc(userA, "2024-01-15", "")); err != nil {
		t.Fatalf("create failed: %v", err)
	}

	_, err := s.GetPlanDocument(context.Background(), userB, "2024-01-15")
	if err != gorm.ErrRecordNotFound {
		t.Errorf("expected ErrRecordNotFound for wrong user, got %v", err)
	}
}

func TestPlanDocGet_UserIsolation(t *testing.T) {
	s := newPlanDocDB(t)
	userA := uuid.New()
	userB := uuid.New()

	docA, _ := s.CreatePlanDocument(context.Background(), makeDoc(userA, "2024-01-15", `[{"a":1}]`))
	docB, _ := s.CreatePlanDocument(context.Background(), makeDoc(userB, "2024-01-15", `[{"b":2}]`))

	gotA, err := s.GetPlanDocument(context.Background(), userA, "2024-01-15")
	if err != nil {
		t.Fatalf("get userA failed: %v", err)
	}
	if gotA.ID != docA.ID {
		t.Errorf("userA doc ID mismatch")
	}

	gotB, err := s.GetPlanDocument(context.Background(), userB, "2024-01-15")
	if err != nil {
		t.Fatalf("get userB failed: %v", err)
	}
	if gotB.ID != docB.ID {
		t.Errorf("userB doc ID mismatch")
	}
}

// ── CreatePlanDocument ────────────────────────────────────────────────────────

func TestPlanDocCreate_AssignsUUID(t *testing.T) {
	s := newPlanDocDB(t)
	doc, err := s.CreatePlanDocument(context.Background(), makeDoc(uuid.New(), "2024-01-15", ""))
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}
	if doc.ID == uuid.Nil {
		t.Error("expected non-nil UUID to be assigned")
	}
}

func TestPlanDocCreate_SetsTimestamps(t *testing.T) {
	s := newPlanDocDB(t)
	before := time.Now().Add(-time.Second)
	doc, err := s.CreatePlanDocument(context.Background(), makeDoc(uuid.New(), "2024-01-15", ""))
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}
	after := time.Now().Add(time.Second)

	if doc.CreatedAt.Before(before) || doc.CreatedAt.After(after) {
		t.Errorf("CreatedAt %v not in expected range [%v, %v]", doc.CreatedAt, before, after)
	}
	if doc.UpdatedAt.Before(before) || doc.UpdatedAt.After(after) {
		t.Errorf("UpdatedAt %v not in expected range", doc.UpdatedAt)
	}
}

func TestPlanDocCreate_TwoUsersSameDate(t *testing.T) {
	s := newPlanDocDB(t)
	userA, userB := uuid.New(), uuid.New()

	if _, err := s.CreatePlanDocument(context.Background(), makeDoc(userA, "2024-01-15", "")); err != nil {
		t.Fatalf("create userA failed: %v", err)
	}
	if _, err := s.CreatePlanDocument(context.Background(), makeDoc(userB, "2024-01-15", "")); err != nil {
		t.Fatalf("create userB failed: %v", err)
	}
}

func TestPlanDocCreate_SameUserDifferentDates(t *testing.T) {
	s := newPlanDocDB(t)
	userID := uuid.New()

	if _, err := s.CreatePlanDocument(context.Background(), makeDoc(userID, "2024-01-15", "")); err != nil {
		t.Fatalf("create date1 failed: %v", err)
	}
	if _, err := s.CreatePlanDocument(context.Background(), makeDoc(userID, "2024-01-16", "")); err != nil {
		t.Fatalf("create date2 failed: %v", err)
	}
}

func TestPlanDocCreate_DuplicateReturnsError(t *testing.T) {
	s := newPlanDocDB(t)
	userID := uuid.New()

	if _, err := s.CreatePlanDocument(context.Background(), makeDoc(userID, "2024-01-15", "")); err != nil {
		t.Fatalf("first create failed: %v", err)
	}
	_, err := s.CreatePlanDocument(context.Background(), makeDoc(userID, "2024-01-15", ""))
	if err == nil {
		t.Error("expected error for duplicate (user_id, date), got nil")
	}
}

// ── UpdatePlanDocumentItems ───────────────────────────────────────────────────

func TestPlanDocUpdate_Success(t *testing.T) {
	s := newPlanDocDB(t)
	userID := uuid.New()

	doc, err := s.CreatePlanDocument(context.Background(), makeDoc(userID, "2024-01-15", "[]"))
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}

	newItems := datatypes.JSON([]byte(`[{"title":"Updated"}]`))
	updated, err := s.UpdatePlanDocumentItems(context.Background(), doc.ID, userID, newItems)
	if err != nil {
		t.Fatalf("update failed: %v", err)
	}
	if string(updated.Items) != string(newItems) {
		t.Errorf("expected items %s, got %s", string(newItems), string(updated.Items))
	}
}

func TestPlanDocUpdate_UpdatedAtAdvances(t *testing.T) {
	s := newPlanDocDB(t)
	userID := uuid.New()

	doc, _ := s.CreatePlanDocument(context.Background(), makeDoc(userID, "2024-01-15", "[]"))
	originalUpdatedAt := doc.UpdatedAt

	time.Sleep(2 * time.Millisecond)

	updated, err := s.UpdatePlanDocumentItems(context.Background(), doc.ID, userID, datatypes.JSON([]byte(`[{"x":1}]`)))
	if err != nil {
		t.Fatalf("update failed: %v", err)
	}
	if !updated.UpdatedAt.After(originalUpdatedAt) {
		t.Errorf("expected UpdatedAt to advance: original=%v, new=%v", originalUpdatedAt, updated.UpdatedAt)
	}
}

func TestPlanDocUpdate_NotFoundWrongID(t *testing.T) {
	s := newPlanDocDB(t)
	userID := uuid.New()

	_, err := s.UpdatePlanDocumentItems(context.Background(), uuid.New(), userID, datatypes.JSON([]byte(`[]`)))
	if err != gorm.ErrRecordNotFound {
		t.Errorf("expected ErrRecordNotFound, got %v", err)
	}
}

func TestPlanDocUpdate_NotFoundWrongUser(t *testing.T) {
	s := newPlanDocDB(t)
	userA := uuid.New()
	userB := uuid.New()

	doc, _ := s.CreatePlanDocument(context.Background(), makeDoc(userA, "2024-01-15", "[]"))

	_, err := s.UpdatePlanDocumentItems(context.Background(), doc.ID, userB, datatypes.JSON([]byte(`[]`)))
	if err != gorm.ErrRecordNotFound {
		t.Errorf("expected ErrRecordNotFound for wrong user, got %v", err)
	}
}
