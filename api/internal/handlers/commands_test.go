package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/nomi-api/internal/config"
	"go.uber.org/zap"
)

func newCommandsTestRouter(userID uuid.UUID, brainURL string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	cfg := &config.Config{}
	cfg.LLM.BaseURL = brainURL

	r := gin.New()
	handler := ProxyCommands(cfg, zap.NewNop())
	r.GET("/api/commands", func(c *gin.Context) {
		c.Set("userID", userID)
		handler(c)
	})
	return r
}

func TestProxyCommands_ForwardsXUserID(t *testing.T) {
	userID := uuid.New()

	// Fake brain: assert X-User-ID header and return a commands payload.
	fakeBrain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/commands" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		gotID := r.Header.Get("X-User-ID")
		if gotID != userID.String() {
			t.Errorf("X-User-ID = %q, want %q", gotID, userID.String())
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"commands":[{"name":"memory.note"}]}`))
	}))
	defer fakeBrain.Close()

	r := newCommandsTestRouter(userID, fakeBrain.URL)

	req := httptest.NewRequest(http.MethodGet, "/api/commands", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}

	commands, ok := body["commands"].([]interface{})
	if !ok || len(commands) == 0 {
		t.Fatalf("expected non-empty commands array, got: %v", body)
	}

	first, ok := commands[0].(map[string]interface{})
	if !ok {
		t.Fatalf("commands[0] is not an object")
	}
	if first["name"] != "memory.note" {
		t.Errorf("commands[0].name = %q, want %q", first["name"], "memory.note")
	}
}

func TestProxyCommands_BackendDown(t *testing.T) {
	userID := uuid.New()
	// Point at a port nothing is listening on.
	r := newCommandsTestRouter(userID, "http://127.0.0.1:19999")

	req := httptest.NewRequest(http.MethodGet, "/api/commands", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", w.Code)
	}
}
