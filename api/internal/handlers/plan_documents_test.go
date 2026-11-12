package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/nomi-api/internal/storage"
	"go.uber.org/zap"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// mockPlanDocumentStore is an in-memory implementation of planDocumentStore for tests.
type mockPlanDocumentStore struct {
	getDoc    *storage.PlanDocument
	getErr    error
	createDoc *storage.PlanDocument // if nil, the input doc is echoed back
	createErr error
	updateDoc *storage.PlanDocument
	updateErr error
}

func (m *mockPlanDocumentStore) GetPlanDocument(_ context.Context, _ uuid.UUID, _ string) (*storage.PlanDocument, error) {
	return m.getDoc, m.getErr
}

func (m *mockPlanDocumentStore) CreatePlanDocument(_ context.Context, doc *storage.PlanDocument) (*storage.PlanDocument, error) {
	if m.createErr != nil {
		return nil, m.createErr
	}
	if m.createDoc != nil {
		return m.createDoc, nil
	}
	// echo back: simulate UUID and timestamps being assigned
	if doc.ID == uuid.Nil {
		doc.ID = uuid.New()
	}
	doc.CreatedAt = time.Now()
	doc.UpdatedAt = time.Now()
	return doc, nil
}

func (m *mockPlanDocumentStore) UpdatePlanDocumentItems(_ context.Context, _ uuid.UUID, _ uuid.UUID, _ datatypes.JSON) (*storage.PlanDocument, error) {
	return m.updateDoc, m.updateErr
}

// newTestRouter creates a gin engine in test mode wired to the given handler.
// userID is injected as middleware to simulate the auth layer.
func newTestRouter(userID uuid.UUID, store planDocumentStore) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewPlanDocumentsHandler(store, zap.NewNop())

	r.GET("/api/plan-documents", func(c *gin.Context) {
		c.Set("userID", userID)
		h.GetPlanDocument(c)
	})
	r.POST("/api/plan-documents", func(c *gin.Context) {
		c.Set("userID", userID)
		h.CreatePlanDocument(c)
	})
	r.PATCH("/api/plan-documents/:id", func(c *gin.Context) {
		c.Set("userID", userID)
		h.PatchPlanDocument(c)
	})
	return r
}

// doRequest is a helper that fires a request against the test router and returns the recorder.
func doRequest(r *gin.Engine, method, path string, body []byte) *httptest.ResponseRecorder {
	var reqBody *bytes.Reader
	if body != nil {
		reqBody = bytes.NewReader(body)
	} else {
		reqBody = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reqBody)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// ── GetPlanDocument ──────────────────────────────────────────────────────────

func TestGetPlanDocument_MissingDateParam(t *testing.T) {
	r := newTestRouter(uuid.New(), &mockPlanDocumentStore{})
	w := doRequest(r, http.MethodGet, "/api/plan-documents", nil)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
	var body map[string]string
	json.NewDecoder(w.Body).Decode(&body)
	if body["error"] == "" {
		t.Error("expected error message in response")
	}
}

func TestGetPlanDocument_InvalidDateFormat(t *testing.T) {
	r := newTestRouter(uuid.New(), &mockPlanDocumentStore{})
	w := doRequest(r, http.MethodGet, "/api/plan-documents?date=01/02/2024", nil)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetPlanDocument_NotFound(t *testing.T) {
	store := &mockPlanDocumentStore{getErr: gorm.ErrRecordNotFound}
	r := newTestRouter(uuid.New(), store)
	w := doRequest(r, http.MethodGet, "/api/plan-documents?date=2024-01-15", nil)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestGetPlanDocument_StorageError(t *testing.T) {
	store := &mockPlanDocumentStore{getErr: errors.New("db down")}
	r := newTestRouter(uuid.New(), store)
	w := doRequest(r, http.MethodGet, "/api/plan-documents?date=2024-01-15", nil)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestGetPlanDocument_Success(t *testing.T) {
	docID := uuid.New()
	store := &mockPlanDocumentStore{
		getDoc: &storage.PlanDocument{
			ID:        docID,
			UserID:    uuid.New(),
			Date:      "2024-01-15",
			Items:     datatypes.JSON([]byte(`[{"title":"Task"}]`)),
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		},
	}
	r := newTestRouter(uuid.New(), store)
	w := doRequest(r, http.MethodGet, "/api/plan-documents?date=2024-01-15", nil)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var body map[string]interface{}
	json.NewDecoder(w.Body).Decode(&body)

	if body["id"] != docID.String() {
		t.Errorf("expected id %s, got %v", docID.String(), body["id"])
	}
	if body["date"] != "2024-01-15" {
		t.Errorf("expected date 2024-01-15, got %v", body["date"])
	}
	if _, hasUserID := body["user_id"]; hasUserID {
		t.Error("response must not include user_id")
	}
	if body["items"] == nil {
		t.Error("expected items in response")
	}
}

// ── CreatePlanDocument ───────────────────────────────────────────────────────

func TestCreatePlanDocument_MissingDateField(t *testing.T) {
	r := newTestRouter(uuid.New(), &mockPlanDocumentStore{})
	w := doRequest(r, http.MethodPost, "/api/plan-documents", []byte(`{}`))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreatePlanDocument_InvalidDateFormat(t *testing.T) {
	r := newTestRouter(uuid.New(), &mockPlanDocumentStore{})
	w := doRequest(r, http.MethodPost, "/api/plan-documents", []byte(`{"date":"2024/01/15"}`))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreatePlanDocument_Conflict_PgCode(t *testing.T) {
	store := &mockPlanDocumentStore{createErr: errors.New("pq: ERROR: duplicate key value violates unique constraint (23505)")}
	r := newTestRouter(uuid.New(), store)
	w := doRequest(r, http.MethodPost, "/api/plan-documents", []byte(`{"date":"2024-01-15"}`))

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d", w.Code)
	}
}

func TestCreatePlanDocument_Conflict_DuplicateKeyMessage(t *testing.T) {
	store := &mockPlanDocumentStore{createErr: errors.New("duplicate key violates unique constraint")}
	r := newTestRouter(uuid.New(), store)
	w := doRequest(r, http.MethodPost, "/api/plan-documents", []byte(`{"date":"2024-01-15"}`))

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d", w.Code)
	}
}

func TestCreatePlanDocument_StorageError(t *testing.T) {
	store := &mockPlanDocumentStore{createErr: errors.New("connection refused")}
	r := newTestRouter(uuid.New(), store)
	w := doRequest(r, http.MethodPost, "/api/plan-documents", []byte(`{"date":"2024-01-15"}`))

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestCreatePlanDocument_Success_NoItems(t *testing.T) {
	r := newTestRouter(uuid.New(), &mockPlanDocumentStore{})
	w := doRequest(r, http.MethodPost, "/api/plan-documents", []byte(`{"date":"2024-01-15"}`))

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d\nbody: %s", w.Code, w.Body.String())
	}
	var body map[string]interface{}
	json.NewDecoder(w.Body).Decode(&body)
	// items should default to []
	items, _ := json.Marshal(body["items"])
	if string(items) != "[]" && string(items) != "null" {
		// accept both "[]" and null-ish depending on JSON encoding
		if body["items"] != nil {
			raw, _ := json.Marshal(body["items"])
			if string(raw) != "[]" {
				t.Errorf("expected items to be [], got %s", string(raw))
			}
		}
	}
}

func TestCreatePlanDocument_Success_WithItems(t *testing.T) {
	r := newTestRouter(uuid.New(), &mockPlanDocumentStore{})
	body := []byte(`{"date":"2024-01-15","items":[{"title":"Gym"}]}`)
	w := doRequest(r, http.MethodPost, "/api/plan-documents", body)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d\nbody: %s", w.Code, w.Body.String())
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["date"] != "2024-01-15" {
		t.Errorf("expected date 2024-01-15, got %v", resp["date"])
	}
}

// ── PatchPlanDocument ────────────────────────────────────────────────────────

func TestPatchPlanDocument_InvalidUUID(t *testing.T) {
	r := newTestRouter(uuid.New(), &mockPlanDocumentStore{})
	w := doRequest(r, http.MethodPatch, "/api/plan-documents/not-a-uuid", []byte(`{"items":[]}`))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestPatchPlanDocument_MissingItems(t *testing.T) {
	r := newTestRouter(uuid.New(), &mockPlanDocumentStore{})
	w := doRequest(r, http.MethodPatch, "/api/plan-documents/"+uuid.New().String(), []byte(`{}`))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestPatchPlanDocument_NotFound(t *testing.T) {
	store := &mockPlanDocumentStore{updateErr: gorm.ErrRecordNotFound}
	r := newTestRouter(uuid.New(), store)
	w := doRequest(r, http.MethodPatch, "/api/plan-documents/"+uuid.New().String(), []byte(`{"items":[]}`))

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestPatchPlanDocument_StorageError(t *testing.T) {
	store := &mockPlanDocumentStore{updateErr: errors.New("timeout")}
	r := newTestRouter(uuid.New(), store)
	w := doRequest(r, http.MethodPatch, "/api/plan-documents/"+uuid.New().String(), []byte(`{"items":[]}`))

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestPatchPlanDocument_Success(t *testing.T) {
	docID := uuid.New()
	store := &mockPlanDocumentStore{
		updateDoc: &storage.PlanDocument{
			ID:        docID,
			Date:      "2024-01-15",
			Items:     datatypes.JSON([]byte(`[{"title":"Updated"}]`)),
			UpdatedAt: time.Now(),
		},
	}
	r := newTestRouter(uuid.New(), store)
	w := doRequest(r, http.MethodPatch, "/api/plan-documents/"+docID.String(), []byte(`{"items":[{"title":"Updated"}]}`))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d\nbody: %s", w.Code, w.Body.String())
	}
	var body map[string]interface{}
	json.NewDecoder(w.Body).Decode(&body)
	if body["id"] != docID.String() {
		t.Errorf("expected id %s, got %v", docID.String(), body["id"])
	}
}
