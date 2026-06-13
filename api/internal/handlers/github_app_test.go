package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"go.uber.org/zap"
)

func newTestGHHandler() *GitHubAppHandler {
	cfg := &config.Config{}
	cfg.Token.JWTSecret = "test-secret"
	cfg.GitHub.AppSlug = "nomi"
	return NewGitHubAppHandler(zap.NewNop(), cfg, nil)
}

func TestStateRoundTrip(t *testing.T) {
	h := newTestGHHandler()
	uid := uuid.New()

	state, err := h.signState(uid)
	if err != nil {
		t.Fatalf("signState: %v", err)
	}
	got, err := h.parseState(state)
	if err != nil {
		t.Fatalf("parseState: %v", err)
	}
	if got != uid {
		t.Errorf("user_id = %v, want %v", got, uid)
	}
}

func TestParseStateRejectsTamperedAndWrongPurpose(t *testing.T) {
	h := newTestGHHandler()

	if _, err := h.parseState("garbage"); err == nil {
		t.Error("expected error for garbage state")
	}
	// Signed with a different secret -> must fail.
	other := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": uuid.New().String(),
		"purpose": ghAppStatePurpose,
		"exp":     time.Now().Add(time.Minute).Unix(),
	})
	bad, _ := other.SignedString([]byte("different-secret"))
	if _, err := h.parseState(bad); err == nil {
		t.Error("expected error for state signed with wrong secret")
	}
	// Right secret, wrong purpose -> must fail.
	wrongPurpose := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": uuid.New().String(),
		"purpose": "something_else",
		"exp":     time.Now().Add(time.Minute).Unix(),
	})
	wp, _ := wrongPurpose.SignedString([]byte("test-secret"))
	if _, err := h.parseState(wp); err == nil {
		t.Error("expected error for wrong purpose")
	}
}

// TestRoutePatternsCoexist guards against a gin radix-tree panic at registration:
// the static github-app routes must coexist with /api/integrations/:id, the static
// imap route, and the /api/:plugin/*path catch-all.
func TestRoutePatternsCoexist(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	mark := func(name string) gin.HandlerFunc {
		return func(c *gin.Context) { c.String(http.StatusOK, name) }
	}
	// Order mirrors server.go: catch-all first, then specific integration routes.
	r.Any("/api/:plugin/*path", mark("plugin"))
	r.GET("/api/integrations/:id", mark("byid"))
	r.POST("/api/integrations/imap/credentials", mark("imap"))
	r.GET("/api/integrations/github/app/install", mark("install"))
	r.GET("/api/integrations/github/app/callback", mark("callback"))

	cases := map[string]string{
		"/api/integrations/github/app/install":  "install",
		"/api/integrations/github/app/callback": "callback",
		"/api/integrations/abc123":              "byid",
	}
	for path, want := range cases {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		r.ServeHTTP(w, req)
		if w.Body.String() != want {
			t.Errorf("%s routed to %q, want %q", path, w.Body.String(), want)
		}
	}
}
